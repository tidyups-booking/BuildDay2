import { eq } from "drizzle-orm";
import {
  db,
  companiesTable,
  teamMembersTable,
  type Company,
} from "@workspace/db";

export async function getCompanyForUser(
  userId: string,
): Promise<Company | undefined> {
  const [company] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.ownerUserId, userId));
  return company;
}

export async function serializeCompany(company: Company) {
  const team = await db
    .select()
    .from(teamMembersTable)
    .where(eq(teamMembersTable.companyId, company.id));

  const teamInvited = team.some((m) => m.role !== "owner");
  const phoneProvisioned = !!company.phoneNumber;
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
    phoneNumber: company.phoneNumber,
    jobberConnected: company.jobberConnected,
    jobberAccountName: company.jobberAccountName,
    isLive: company.isLive,
    setupStatus: {
      accountCreated: true,
      jobberConnected: company.jobberConnected,
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
