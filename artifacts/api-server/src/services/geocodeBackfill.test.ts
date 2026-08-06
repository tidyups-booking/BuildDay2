/**
 * Backfill tests: proves it resolves upcoming un-geocoded bookings via an
 * injected stub, skips the unresolvable ones so they can't starve the batch,
 * and degrades quietly (no throw, logs once) when the key is denied.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

import { db, pool, companiesTable, bookingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  setGeocoder,
  resetGeocoder,
  clearGeocodeCache,
  GeocodeConfigError,
} from "./geocode";
import { runGeocodeBackfill, _resetBackfillState } from "./geocodeBackfill";

const runId = `${Date.now()}_${process.pid}`;
let companyId: number;
let resolvableId: number;
let unresolvableId: number;

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

beforeAll(async () => {
  const [company] = await db
    .insert(companiesTable)
    .values({ ownerUserId: `bf_owner_${runId}`, name: `Backfill Co ${runId}` })
    .returning();
  companyId = company!.id;

  const bookings = await db
    .insert(bookingsTable)
    .values([
      {
        companyId,
        callId: null,
        customerName: "Resolvable",
        customerPhone: "+15550001111",
        customerAddress: "1 Real St",
        service: "Deep clean",
        scheduledFor: FUTURE,
        status: "confirmed",
      },
      {
        companyId,
        callId: null,
        customerName: "Unresolvable",
        customerPhone: "+15550002222",
        customerAddress: "gibberish that resolves to nothing",
        service: "Deep clean",
        scheduledFor: FUTURE,
        status: "confirmed",
      },
    ])
    .returning();
  resolvableId = bookings[0]!.id;
  unresolvableId = bookings[1]!.id;
});

afterEach(() => {
  resetGeocoder();
  clearGeocodeCache();
  _resetBackfillState();
});

afterAll(async () => {
  await db.delete(bookingsTable).where(eq(bookingsTable.companyId, companyId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

describe("runGeocodeBackfill", () => {
  it("persists coordinates for resolvable rows and skips the rest", async () => {
    setGeocoder(async (address) =>
      address.includes("Real") ? { lat: 40, lng: -75 } : null,
    );
    await runGeocodeBackfill();

    const rows = await db
      .select()
      .from(bookingsTable)
      .where(inArray(bookingsTable.id, [resolvableId, unresolvableId]));
    const resolvable = rows.find((r) => r.id === resolvableId)!;
    const unresolvable = rows.find((r) => r.id === unresolvableId)!;

    expect(resolvable.lat).toBe(40);
    expect(resolvable.lng).toBe(-75);
    expect(resolvable.geocodedAt).not.toBeNull();
    // Unresolvable stays null and is remembered in the skip list.
    expect(unresolvable.lat).toBeNull();
  });

  it("degrades quietly when the key is denied — no throw, nothing written", async () => {
    // Reset the resolvable row so we can prove nothing gets written.
    await db
      .update(bookingsTable)
      .set({ lat: null, lng: null, geocodedAt: null })
      .where(eq(bookingsTable.id, resolvableId));

    setGeocoder(async () => {
      throw new GeocodeConfigError("REQUEST_DENIED");
    });

    await expect(runGeocodeBackfill()).resolves.toBeUndefined();

    const [row] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, resolvableId));
    expect(row!.lat).toBeNull();
  });
});
