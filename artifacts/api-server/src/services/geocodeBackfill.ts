import { and, asc, eq, gt, isNull, isNotNull } from "drizzle-orm";
import { db, bookingsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { geocodeAddress, GeocodeConfigError } from "./geocode";

/**
 * Background geocoding of upcoming bookings so the live map loads pins straight
 * from the DB rather than hitting Google on every dashboard open.
 *
 * Every cycle it takes a small batch of future bookings that have an address
 * but no coordinates and resolves them. Addresses that come back
 * unresolvable are remembered in a per-process skip list so they can't sit at
 * the front of the batch window forever and starve out bookings that would
 * resolve fine.
 *
 * When the key is missing or Google answers REQUEST_DENIED, the whole thing
 * degrades quietly: it logs once, stops for the cycle, and does not crash the
 * server or spam the logs every ten minutes.
 */

/** Ten minutes: often enough that a new booking is on the map soon, gentle on quota. */
export const GEOCODE_BACKFILL_INTERVAL_MS = 10 * 60 * 1000;
/** How many bookings to attempt per cycle, so one run can't blow the quota. */
const BATCH_SIZE = 25;

// Booking ids we've already tried and Google couldn't place. Per-process only:
// a restart re-tries them, an address edit clears geocodedAt and gets a fresh
// look regardless (edited rows keep lat/lng null with a new id? no — same id,
// so an explicit clear on edit is what re-queues them).
const skipList = new Set<number>();

// Latched so a dead/denied key logs one warning per process, not one per cycle.
let configErrorLogged = false;

export async function runGeocodeBackfill(): Promise<void> {
  const candidates = await db
    .select({
      id: bookingsTable.id,
      address: bookingsTable.customerAddress,
    })
    .from(bookingsTable)
    .where(
      and(
        isNull(bookingsTable.lat),
        isNull(bookingsTable.lng),
        isNotNull(bookingsTable.customerAddress),
        // Only jobs still ahead of us are worth placing on the map.
        gt(bookingsTable.scheduledFor, new Date()),
      ),
    )
    .orderBy(asc(bookingsTable.scheduledFor))
    // Pull more than the batch so the skip list can be filtered out without
    // an extra query and still leave a full batch of live work.
    .limit(BATCH_SIZE + skipList.size);

  const batch = candidates
    .filter((c) => !skipList.has(c.id) && c.address)
    .slice(0, BATCH_SIZE);
  if (batch.length === 0) return;

  for (const row of batch) {
    try {
      const coords = await geocodeAddress(row.address!);
      if (!coords) {
        // Google placed nothing — don't try this row again this process.
        skipList.add(row.id);
        continue;
      }
      await db
        .update(bookingsTable)
        .set({ lat: coords.lat, lng: coords.lng, geocodedAt: new Date() })
        .where(
          and(
            eq(bookingsTable.id, row.id),
            // Still unresolved — an edit or a concurrent run may have changed it.
            isNull(bookingsTable.lat),
          ),
        );
    } catch (err) {
      if (err instanceof GeocodeConfigError) {
        // A missing/denied key means the whole cycle is pointless. Log once,
        // then bail so we don't hammer Google (or the logs) with every row.
        if (!configErrorLogged) {
          logger.warn(
            { err },
            "Geocode backfill paused: Google Maps key missing or denied",
          );
          configErrorLogged = true;
        }
        return;
      }
      // A transient failure on one row shouldn't sink the batch; leave the row
      // unresolved so a later cycle retries it.
      logger.warn({ err, bookingId: row.id }, "Geocode backfill row failed");
    }
  }
}

let timer: NodeJS.Timeout | null = null;

/**
 * Start the backfill loop. First pass shortly after boot (once startup traffic
 * settles), then every ten minutes.
 */
export function startGeocodeBackfill(): void {
  if (timer) return;
  const run = () => {
    runGeocodeBackfill().catch((err) =>
      logger.error({ err }, "Geocode backfill run failed"),
    );
  };
  setTimeout(run, 90 * 1000).unref();
  timer = setInterval(run, GEOCODE_BACKFILL_INTERVAL_MS);
  timer.unref();
}

/** Test seam: clear the per-process skip list and config-error latch. */
export function _resetBackfillState(): void {
  skipList.clear();
  configErrorLogged = false;
}
