import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, companiesTable, teamMembersTable, activityTable } from "@workspace/db";
import {
  CreateCompanyBody,
  UpdateCompanyBody,
  GetCompanyResponse,
  CreateCompanyResponse,
  UpdateCompanyResponse,
  ConnectJobberResponse,
  DisconnectJobberResponse,
  GoLiveResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { getCompanyForUser, serializeCompany } from "../lib/company";

const router: IRouter = Router();

router.use(requireAuth);

router.get("/company", async (req, res): Promise<void> => {
  const company = await getCompanyForUser(req.userId!);
  if (!company) {
    res.status(404).json({ error: "No company yet" });
    return;
  }
  res.json(GetCompanyResponse.parse(await serializeCompany(company)));
});

router.post("/company", async (req, res): Promise<void> => {
  const parsed = CreateCompanyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await getCompanyForUser(req.userId!);
  if (existing) {
    res.status(201).json(CreateCompanyResponse.parse(await serializeCompany(existing)));
    return;
  }

  const [company] = await db
    .insert(companiesTable)
    .values({
      ownerUserId: req.userId!,
      name: parsed.data.name,
      greeting: `Thanks for calling ${parsed.data.name}! How can I help you today?`,
      collectFields: ["name", "address", "service type", "preferred date"],
      customQuestions: [],
    })
    .returning();

  await db.insert(teamMembersTable).values({
    companyId: company!.id,
    name: "You",
    email: "owner@company.com",
    role: "owner",
    status: "active",
  });

  res.status(201).json(CreateCompanyResponse.parse(await serializeCompany(company!)));
});

router.patch("/company", async (req, res): Promise<void> => {
  const parsed = UpdateCompanyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const company = await getCompanyForUser(req.userId!);
  if (!company) {
    res.status(404).json({ error: "No company yet" });
    return;
  }

  const touchesConfig =
    parsed.data.greeting !== undefined ||
    parsed.data.collectFields !== undefined ||
    parsed.data.customQuestions !== undefined ||
    parsed.data.ringThroughNumber !== undefined;

  const [updated] = await db
    .update(companiesTable)
    .set({
      ...parsed.data,
      ...(touchesConfig ? { receptionistConfigured: true } : {}),
    })
    .where(eq(companiesTable.id, company.id))
    .returning();

  res.json(UpdateCompanyResponse.parse(await serializeCompany(updated!)));
});

router.post("/company/jobber/connect", async (req, res): Promise<void> => {
  const company = await getCompanyForUser(req.userId!);
  if (!company) {
    res.status(404).json({ error: "No company yet" });
    return;
  }
  const [updated] = await db
    .update(companiesTable)
    .set({ jobberConnected: true, jobberAccountName: company.name })
    .where(eq(companiesTable.id, company.id))
    .returning();

  res.json(ConnectJobberResponse.parse(await serializeCompany(updated!)));
});

router.post("/company/jobber/disconnect", async (req, res): Promise<void> => {
  const company = await getCompanyForUser(req.userId!);
  if (!company) {
    res.status(404).json({ error: "No company yet" });
    return;
  }
  const [updated] = await db
    .update(companiesTable)
    .set({ jobberConnected: false, jobberAccountName: null })
    .where(eq(companiesTable.id, company.id))
    .returning();

  res.json(DisconnectJobberResponse.parse(await serializeCompany(updated!)));
});

router.post("/company/go-live", async (req, res): Promise<void> => {
  const company = await getCompanyForUser(req.userId!);
  if (!company) {
    res.status(404).json({ error: "No company yet" });
    return;
  }
  const [updated] = await db
    .update(companiesTable)
    .set({ isLive: true })
    .where(eq(companiesTable.id, company.id))
    .returning();

  await db.insert(activityTable).values({
    companyId: company.id,
    type: "call_answered",
    message: `${company.name} is live — the AI receptionist is now answering calls.`,
  });

  res.json(GoLiveResponse.parse(await serializeCompany(updated!)));
});

export default router;
