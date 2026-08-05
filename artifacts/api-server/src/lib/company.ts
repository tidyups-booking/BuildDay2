import { and, eq } from "drizzle-orm";
import {
  db,
  companiesTable,
  teamMembersTable,
  type Company,
} from "@workspace/db";
import { listPhoneNumbers, QuoError } from "./quo";
import { decryptQuoKey } from "./secretBox";
import { notifyOwnerQuoKeyDead, notifyOwnerQuoRestored } from "./ownerNotify";
import { logger } from "./logger";

export async function getCompanyForUser(
  userId: string,
): Promise<Company | undefined> {
  const [company] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.ownerUserId, userId));
  return company;
}

/** The company's decrypted Quo key, or null if they have not connected one. */
export function companyQuoKey(company: Company): string | null {
  return decryptQuoKey(company.quoApiKeyEncrypted);
}

/**
 * Same, but throws a 503-shaped QuoError when the key is missing or no longer
 * decryptable, so routes surface "reconnect Quo" rather than a generic failure.
 */
export function requireCompanyQuoKey(company: Company): string {
  const key = companyQuoKey(company);
  if (!key) {
    throw new QuoError("This company needs to reconnect its Quo account", 503);
  }
  return key;
}

/** True when the error means Quo rejected the key itself (revoked/rotated). */
export function isQuoAuthError(err: unknown): boolean {
  return err instanceof QuoError && (err.status === 401 || err.status === 403);
}
export async function serializeCompany(company: Company) {
  const team = await db
    .select()
    .from(teamMembersTable)
    .where(eq(teamMembersTable.companyId, company.id));

  const teamInvited = team.some((m) => m.role !== "owner");
  // A line is "provisioned" once the receptionist is watching at least one
  // real Quo number.
  const phoneProvisioned = company.quoNumberIds.length > 0;

  let watchedNumbers: Array<{
    id: string;
    phoneNumber: string;
    name: string;
    watched: boolean;
  }> = [];
  const quoKey = companyQuoKey(company);
  if (quoKey && company.quoNumberIds.length > 0) {
    try {
      const numbers = await listPhoneNumbers(quoKey);
      await setQuoNeedsReauth(company, false);
      watchedNumbers = numbers
        .filter((n) => company.quoNumberIds.includes(n.id))
        .map((n) => ({
          id: n.id,
          phoneNumber: n.number,
          name: n.name ?? n.number,
          watched: true,
        }));
    } catch (err) {
      // A 401/403 means the key itself is dead — record it so the dashboard
      // can warn the owner instead of failing silently.
      if (isQuoAuthError(err)) await setQuoNeedsReauth(company, true);
      // Quo being unreachable must not break the dashboard; fall back to ids.
      watchedNumbers = company.quoNumberIds.map((id) => ({
        id,
        phoneNumber: "",
        name: id,
        watched: true,
      }));
    }
  }

  // Jobber is optional: connecting it or deliberately skipping it both count
  // as having dealt with the step, so the wizard stops blocking either way.
  const jobberResolved = company.jobberConnected || company.jobberSkipped;

  const steps = [
    true, // account created
    jobberResolved,
    phoneProvisioned,
    company.receptionistConfigured,
    teamInvited,
    company.isLive,
  ];

  return {
    id: company.id,
    name: company.name,
    greeting: company.greeting,
    collectFields: company.collectFields,
    customQuestions: company.customQuestions,
    ringThroughNumber: company.ringThroughNumber,
    notificationNumber: company.notificationNumber,
    phoneNumber: watchedNumbers[0]?.phoneNumber || company.phoneNumber,
    timezone: company.timezone,
    jobberConnected: company.jobberConnected,
    jobberSkipped: company.jobberSkipped,
    jobberAccountName: company.jobberAccountName,
    jobberNeedsReauth: company.jobberNeedsReauth,
    quoConnected: company.quoConnected,
    quoWorkspaceName: company.quoWorkspaceName,
    quoKeyLast4: company.quoKeyLast4,
    quoNeedsReauth: company.quoNeedsReauth,
    quoteRateSolo: company.quoteRateSolo,
    quoteRateTeam: company.quoteRateTeam,
    quoteFuelSurcharge: company.quoteFuelSurcharge,
    quoteTaxLabel: company.quoteTaxLabel,
    quoteTaxRate: company.quoteTaxRate,
    quoteFeesLabel: company.quoteFeesLabel,
    quoteFeesRate: company.quoteFeesRate,
    quoteDepositAmount: company.quoteDepositAmount,
    quoteDepositEmail: company.quoteDepositEmail,
    watchedNumbers,
    isLive: company.isLive,
    setupStatus: {
      accountCreated: true,
      jobberConnected: company.jobberConnected,
      jobberSkipped: company.jobberSkipped,
      jobberResolved,
      quoConnected: company.quoConnected,
      phoneProvisioned,
      receptionistConfigured: company.receptionistConfigured,
      teamInvited,
      isLive: company.isLive,
      completedSteps: steps.filter(Boolean).length,
      totalSteps: steps.length,
    },
    createdAt: company.createdAt.toISOString(),
  };
}

/**
 * Persist whether Quo currently rejects this company's key. Only writes when
 * the flag actually changes, so hot paths (webhooks, dashboard) don't churn
 * the row on every call.
 *
 * The write is conditional on the row still holding the opposite value, so a
 * healthy → needs-reauth transition is claimed exactly once even when the
 * hourly health check and a webhook race. The caller that wins the claim
 * notifies the owner directly (best-effort text with a reconnect link).
 *
 * If the winning caller's send *fails* (network blip, Quo 5xx…), the claim is
 * released by reverting the flag, so the next health check or webhook
 * re-claims the transition and retries the text — a transient send failure
 * never permanently swallows the one-per-outage notification. Sends that were
 * *skipped* for configuration reasons (no ring-through number, no platform
 * key) keep the claim: retrying can't succeed until the configuration is
 * fixed, and the flag must stay accurate for the dashboard.
 */
export async function setQuoNeedsReauth(
  company: Company,
  needsReauth: boolean,
): Promise<void> {
  if (company.quoNeedsReauth === needsReauth) return;
  const [claimed] = await db
    .update(companiesTable)
    .set({ quoNeedsReauth: needsReauth })
    .where(
      and(
        eq(companiesTable.id, company.id),
        eq(companiesTable.quoNeedsReauth, !needsReauth),
      ),
    )
    .returning({ id: companiesTable.id });
  company.quoNeedsReauth = needsReauth;
  if (!claimed) return;
  // Fired only on the claimed transition, so the owner gets one text per
  // outage (and one per recovery), not one per hourly check.
  const outcome = needsReauth
    ? await notifyOwnerQuoKeyDead(company)
    : await notifyOwnerQuoRestored(company);
  if (outcome !== "failed") return;
  // The send itself errored — likely transient. Release the claim so the next
  // health check or webhook re-runs this transition and retries the text.
  await db
    .update(companiesTable)
    .set({ quoNeedsReauth: !needsReauth })
    .where(
      and(
        eq(companiesTable.id, company.id),
        eq(companiesTable.quoNeedsReauth, needsReauth),
      ),
    );
  company.quoNeedsReauth = !needsReauth;
  logger.warn(
    { companyId: company.id, needsReauth },
    "Owner notification send failed; released quoNeedsReauth claim so the text is retried on the next check",
  );
}
