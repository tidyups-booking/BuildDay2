/**
 * A seat held by a Clerk account that no longer exists.
 *
 * This happens two ways: the account was deleted, or the database was copied
 * between Clerk instances (a development dump restored into production) so
 * every stored user id was never valid there in the first place. Either way
 * the seat still reads as "claimed", the invite match skips it, and the real
 * person is dropped into onboarding on every sign-in — where the only thing
 * on offer is creating a second, empty company beside the one they belong to.
 *
 * These tests pin the release and, just as importantly, the three cases that
 * must NOT release a seat: a live holder, an unverified email, and Clerk
 * being unreachable.
 */
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

type ClerkAccount = { emails: Array<{ address: string; verified: boolean }> };

const clerkAccounts = new Map<string, ClerkAccount>();
let clerkUnreachable = false;

vi.mock("@clerk/express", () => ({
  clerkClient: {
    users: {
      getUser: async (id: string) => {
        if (clerkUnreachable) throw new Error("clerk down");
        const account = clerkAccounts.get(id);
        if (!account) {
          // Shape matches Clerk's own not-found error.
          throw Object.assign(new Error("Not Found"), { status: 404 });
        }
        return {
          emailAddresses: account.emails.map((e) => ({
            emailAddress: e.address,
            verification: { status: e.verified ? "verified" : "unverified" },
          })),
          firstName: "Test",
          lastName: "User",
        };
      },
    },
  },
}));

import {
  db,
  pool,
  companiesTable,
  teamMembersTable,
  activityTable,
  bookingsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { resolveCaller, forgetDeniedCaller } from "./callerRole";

const runId = Math.random().toString(36).slice(2, 8);
const SEAT_EMAIL = `joseph_${runId}@test.invalid`;
const GHOST_USER = `user_ghost_${runId}`;
const LIVE_USER = `user_live_${runId}`;
const RETURNING_USER = `user_returning_${runId}`;

let companyId: number;
let seatId: number;

beforeAll(async () => {
  const [company] = await db
    .insert(companiesTable)
    .values({
      ownerUserId: `user_owner_${runId}`,
      name: `Reclaim Co ${runId}`,
      timezone: "America/Edmonton",
    })
    .returning();
  companyId = company!.id;

  const [seat] = await db
    .insert(teamMembersTable)
    .values({
      companyId,
      name: "Joseph",
      email: SEAT_EMAIL,
      role: "dispatcher",
      status: "active",
      clerkUserId: GHOST_USER,
    })
    .returning();
  seatId = seat!.id;
});

afterAll(async () => {
  await db.delete(activityTable).where(eq(activityTable.companyId, companyId));
  await db.delete(bookingsTable).where(eq(bookingsTable.companyId, companyId));
  await db
    .delete(teamMembersTable)
    .where(eq(teamMembersTable.companyId, companyId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

beforeEach(async () => {
  clerkUnreachable = false;
  clerkAccounts.clear();
  forgetDeniedCaller();
  // Back to the broken state: the seat is held by an account Clerk no longer
  // knows about.
  await db
    .update(teamMembersTable)
    .set({ clerkUserId: GHOST_USER })
    .where(eq(teamMembersTable.id, seatId));
});

describe("a seat held by a deleted Clerk account", () => {
  it("is released to the same verified email signing in again", async () => {
    clerkAccounts.set(RETURNING_USER, {
      emails: [{ address: SEAT_EMAIL, verified: true }],
    });

    const caller = await resolveCaller(RETURNING_USER);

    // The whole point: they land in their real company as a dispatcher, not
    // in onboarding as a would-be owner of nothing.
    expect(caller.role).toBe("dispatcher");
    expect(caller.company?.id).toBe(companyId);
    expect(caller.teamMemberId).toBe(seatId);

    const [row] = await db
      .select({ clerkUserId: teamMembersTable.clerkUserId })
      .from(teamMembersTable)
      .where(eq(teamMembersTable.id, seatId));
    expect(row?.clerkUserId).toBe(RETURNING_USER);
  });

  it("stays put when the holder's account still exists", async () => {
    await db
      .update(teamMembersTable)
      .set({ clerkUserId: LIVE_USER })
      .where(eq(teamMembersTable.id, seatId));
    clerkAccounts.set(LIVE_USER, {
      emails: [{ address: SEAT_EMAIL, verified: true }],
    });
    clerkAccounts.set(RETURNING_USER, {
      emails: [{ address: SEAT_EMAIL, verified: true }],
    });

    const caller = await resolveCaller(RETURNING_USER);

    // Sharing an address with a live colleague must never take their seat.
    expect(caller.company).toBeNull();
    const [row] = await db
      .select({ clerkUserId: teamMembersTable.clerkUserId })
      .from(teamMembersTable)
      .where(eq(teamMembersTable.id, seatId));
    expect(row?.clerkUserId).toBe(LIVE_USER);
  });

  it("stays put for an unverified email", async () => {
    clerkAccounts.set(RETURNING_USER, {
      emails: [{ address: SEAT_EMAIL, verified: false }],
    });

    const caller = await resolveCaller(RETURNING_USER);

    // Anyone can type an address into a signup form; only verification
    // proves they own it.
    expect(caller.company).toBeNull();
    const [row] = await db
      .select({ clerkUserId: teamMembersTable.clerkUserId })
      .from(teamMembersTable)
      .where(eq(teamMembersTable.id, seatId));
    expect(row?.clerkUserId).toBe(GHOST_USER);
  });

  it("stays put while Clerk is unreachable", async () => {
    clerkAccounts.set(RETURNING_USER, {
      emails: [{ address: SEAT_EMAIL, verified: true }],
    });
    clerkUnreachable = true;

    const caller = await resolveCaller(RETURNING_USER);

    // An outage must not be read as "that account is gone" — that would hand
    // seats away every time Clerk hiccups.
    expect(caller.company).toBeNull();
    const [row] = await db
      .select({ clerkUserId: teamMembersTable.clerkUserId })
      .from(teamMembersTable)
      .where(eq(teamMembersTable.id, seatId));
    expect(row?.clerkUserId).toBe(GHOST_USER);
  });

  it("leaves other companies' seats alone", async () => {
    clerkAccounts.set(RETURNING_USER, {
      emails: [{ address: `stranger_${runId}@test.invalid`, verified: true }],
    });

    const caller = await resolveCaller(RETURNING_USER);

    expect(caller.company).toBeNull();
    const rows = await db
      .select({ clerkUserId: teamMembersTable.clerkUserId })
      .from(teamMembersTable)
      .where(inArray(teamMembersTable.id, [seatId]));
    expect(rows[0]?.clerkUserId).toBe(GHOST_USER);
  });
});
