import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import {
  db,
  companiesTable,
  teamMembersTable,
  activityTable,
  type Company,
} from "@workspace/db";
import { logger } from "./logger";

/**
 * Who is calling, and what they are allowed to touch.
 *
 * OWNER      — the Clerk account on `companies.owner_user_id`, or a signed-in
 *              account that has no company yet and is about to create one.
 *              Full access, including company configuration and billing.
 * DISPATCHER — holds a `team_members` seat with role `dispatcher`. Runs the
 *              day-to-day board: calls, bookings, quotes, crews. Cannot touch
 *              company configuration, Quo/Jobber connections or the team.
 * CLEANER    — holds a `team_members` seat with role `cleaner`. Sees only the
 *              jobs they are assigned to, and may only move those between
 *              statuses.
 *
 * This is the authorization boundary for the whole API. Resolving a company
 * is NOT the same as being allowed to act on it — routes must state which
 * roles they accept via `requireRole`.
 */
export type CallerRole = "owner" | "dispatcher" | "cleaner";

export type Caller = {
  role: CallerRole;
  /**
   * Null only for a signed-in account with no company and no seat — a
   * prospective owner part-way through onboarding.
   */
  company: Company | null;
  /** Null for the owner, whose access comes from owning the company. */
  teamMemberId: number | null;
  /** Seat display fields. Empty for an owner; `/me` enriches those override. */
  name: string;
  email: string;
};

/**
 * Signed-in accounts that matched nothing are cached briefly so a visitor
 * refreshing the page does not hit Clerk on every request, while an invite
 * created seconds ago still takes effect within the minute.
 */
const BOOTSTRAP_RECHECK_MS = 60_000;
const bootstrapNegativeCache = new Map<string, number>();

/** Verified addresses only — verification is what proves the caller owns it. */
async function verifiedEmailsFor(userId: string): Promise<string[]> {
  const user = await clerkClient.users.getUser(userId);
  return user.emailAddresses
    .filter((e) => e.verification?.status === "verified")
    .map((e) => e.emailAddress.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * First sign-in for an invited person: match a VERIFIED Clerk email to a seat
 * that nobody has claimed yet and attach the account to it.
 *
 * This is the only path that calls Clerk, and it is skipped entirely for
 * anyone who already owns a company or holds a seat — so the common request
 * never leaves the database.
 */
async function tryClaimSeat(userId: string): Promise<Caller | null> {
  const dueAt = bootstrapNegativeCache.get(userId);
  if (dueAt !== undefined && Date.now() < dueAt) return null;

  let emails: string[];
  try {
    emails = await verifiedEmailsFor(userId);
  } catch (err) {
    // Not cached: a Clerk outage must not lock a legitimate invitee out for
    // the full window once Clerk recovers.
    logger.error({ err, userId }, "[callerRole] Clerk user lookup failed");
    return null;
  }

  if (emails.length > 0) {
    // Oldest matching invite wins, so the outcome is deterministic when two
    // companies happen to have invited the same address.
    const [pending] = await db
      .select({ id: teamMembersTable.id })
      .from(teamMembersTable)
      .where(
        and(
          isNull(teamMembersTable.clerkUserId),
          inArray(sql`lower(${teamMembersTable.email})`, emails),
        ),
      )
      .orderBy(teamMembersTable.id)
      .limit(1);

    // Re-checking `clerk_user_id IS NULL` in the UPDATE is what makes this
    // safe: two concurrent first requests cannot both take the seat, and a
    // seat claimed or deleted while Clerk was being queried is simply missed
    // rather than resurrected.
    const [claimed] = pending
      ? await db
          .update(teamMembersTable)
          .set({ clerkUserId: userId, status: "active", claimedAt: new Date() })
          .where(
            and(
              eq(teamMembersTable.id, pending.id),
              isNull(teamMembersTable.clerkUserId),
            ),
          )
          .returning()
      : [];

    if (claimed) {
      const [company] = await db
        .select()
        .from(companiesTable)
        .where(eq(companiesTable.id, claimed.companyId));

      if (company) {
        bootstrapNegativeCache.delete(userId);
        await db.insert(activityTable).values({
          companyId: company.id,
          type: "team_invited",
          message: `${claimed.name} accepted their invite and can now sign in as a ${claimed.role}.`,
        });
        return {
          role: claimed.role as CallerRole,
          company,
          teamMemberId: claimed.id,
          name: claimed.name,
          email: claimed.email,
        };
      }
    }
  }

  bootstrapNegativeCache.set(userId, Date.now() + BOOTSTRAP_RECHECK_MS);
  return null;
}

export async function resolveCaller(userId: string): Promise<Caller> {
  // Owning a company always wins, so an owner who was also invited as a
  // cleaner keeps full access rather than being locked into the crew view.
  const [owned] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.ownerUserId, userId));
  if (owned) {
    return {
      role: "owner",
      company: owned,
      teamMemberId: null,
      name: "",
      email: "",
    };
  }

  const [seat] = await db
    .select()
    .from(teamMembersTable)
    .where(eq(teamMembersTable.clerkUserId, userId))
    .limit(1);

  if (seat) {
    const [company] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.id, seat.companyId));
    if (company) {
      return {
        role: seat.role as CallerRole,
        company,
        teamMemberId: seat.id,
        name: seat.name,
        email: seat.email,
      };
    }
  }

  const claimed = await tryClaimSeat(userId);
  if (claimed) return claimed;

  // Nothing to attach to: treat as a prospective owner so onboarding can
  // create a company. They can reach nothing else, because every other route
  // requires a resolved company.
  return {
    role: "owner",
    company: null,
    teamMemberId: null,
    name: "",
    email: "",
  };
}

/** Clear the negative cache so a fresh invite is honoured immediately. */
export function forgetDeniedCaller(): void {
  bootstrapNegativeCache.clear();
}
