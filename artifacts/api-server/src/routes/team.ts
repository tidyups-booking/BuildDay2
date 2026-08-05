import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, teamMembersTable, activityTable } from "@workspace/db";
import {
  ListTeamMembersResponse,
  InviteTeamMemberBody,
  InviteTeamMemberResponse,
  RemoveTeamMemberParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { getCompanyForUser } from "../lib/company";

const router: IRouter = Router();

router.use(requireAuth);

function serializeMember(m: typeof teamMembersTable.$inferSelect) {
  return { ...m, createdAt: m.createdAt.toISOString() };
}

router.get("/team", async (req, res): Promise<void> => {
  const company = await getCompanyForUser(req.userId!);
  if (!company) {
    res.json(ListTeamMembersResponse.parse([]));
    return;
  }
  const members = await db
    .select()
    .from(teamMembersTable)
    .where(eq(teamMembersTable.companyId, company.id))
    .orderBy(teamMembersTable.id);
  res.json(ListTeamMembersResponse.parse(members.map(serializeMember)));
});

router.post("/team", async (req, res): Promise<void> => {
  const parsed = InviteTeamMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const company = await getCompanyForUser(req.userId!);
  if (!company) {
    res.status(404).json({ error: "No company yet" });
    return;
  }
  const [member] = await db
    .insert(teamMembersTable)
    .values({ ...parsed.data, companyId: company.id, status: "invited" })
    .returning();

  await db.insert(activityTable).values({
    companyId: company.id,
    type: "team_invited",
    message: `${parsed.data.name} was invited as a ${parsed.data.role}.`,
  });

  res
    .status(201)
    .json(InviteTeamMemberResponse.parse(serializeMember(member!)));
});

router.delete("/team/:id", async (req, res): Promise<void> => {
  const params = RemoveTeamMemberParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const company = await getCompanyForUser(req.userId!);
  if (!company) {
    res.status(404).json({ error: "No company yet" });
    return;
  }
  const [member] = await db
    .delete(teamMembersTable)
    .where(
      and(
        eq(teamMembersTable.id, params.data.id),
        eq(teamMembersTable.companyId, company.id),
      ),
    )
    .returning();
  if (!member) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
