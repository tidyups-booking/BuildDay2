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
    throw new QuoError(
      "This company needs to reconnect its Quo account",
      503,
    );
  }
  return key;
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
      watchedNumbers = numbers
        .filter((n) => company.quoNumberIds.includes(n.id))
        .map((n) => ({
          id: n.id,
          phoneNumber: n.number,
          name: n.name ?? n.number,
          watched: true,
        }));
    } catch {
      // Quo being unreachable must not break the dashboard; fall back to ids.
      watchedNumbers = company.quoNumberIds.map((id) => ({
        id,
        phoneNumber: "",
        name: id,
        watched: true,
      }));
    }
  }

  const steps = [
    true, // account created
    company.jobberConnected,
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
    jobberConnected: company.jobberConnected,
    jobberAccountName: company.jobberAccountName,
    jobberNeedsReauth: company.jobberNeedsReauth,
    quoConnected: company.quoConnected,
    quoWorkspaceName: company.quoWorkspaceName,
    quoKeyLast4: company.quoKeyLast4,
    watchedNumbers,
    isLive: company.isLive,
    setupStatus: {
      accountCreated: true,
      jobberConnected: company.jobberConnected,
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
