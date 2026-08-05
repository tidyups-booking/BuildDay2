import { eq } from "drizzle-orm";
import {
  db,
  companiesTable,
  teamMembersTable,
  type Company,
} from "@workspace/db";
import { listPhoneNumbers, QuoError } from "./quo";
import { decryptQuoKey } from "./secretBox";

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
  return (
    err instanceof QuoError && (err.status === 401 || err.status === 403)
  );
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
 */
export async function setQuoNeedsReauth(
  company: Company,
  needsReauth: boolean,
): Promise<void> {
  if (company.quoNeedsReauth === needsReauth) return;
  await db
    .update(companiesTable)
    .set({ quoNeedsReauth: needsReauth })
    .where(eq(companiesTable.id, company.id));
  company.quoNeedsReauth = needsReauth;
}
