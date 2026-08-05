import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import { db, teamMembersTable, activityTable } from "@workspace/db";
import {
  ListTeamMembersResponse,
  InviteTeamMemberBody,
  InviteTeamMemberResponse,
  RemoveTeamMemberParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole } from "../middlewares/requireRole";
import { forgetDeniedCaller } from "../lib/callerRole";
import { getCaller } from "../middlewares/requireRole";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.use(requireAuth);
// Dispatchers read the roster to build crews; only the owner may change it,
// which each mutating handler re-checks.
router.use(requireRole("owner", "dispatcher"));

function serializeMember(m: typeof teamMembersTable.$inferSelect) {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    role: m.role,
    status: m.status,
    // The two facts the Team page needs to stop lying about invites: whether
    // this person can actually sign in, and whether the email really went.
    hasLogin: m.clerkUserId !== null,
    inviteEmailSent: m.clerkInvitationId !== null,
    claimedAt: m.claimedAt ? m.claimedAt.toISOString() : null,
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * Where the invitation email's sign-up link should land. Clerk's development
 * and production instances have separate user stores, so the link has to
 * point back at the SAME environment that sent it — otherwise the invitee
 * creates an account the app cannot see.
 */
function inviteRedirectUrl(): string {
  const domain =
    process.env["REPLIT_DEPLOYMENT"] === "1"
      ? process.env["REPLIT_DOMAINS"]?.split(",")[0]?.trim()
      : process.env["REPLIT_DEV_DOMAIN"]?.trim();
  return domain ? `https://${domain}/` : "/";
}

/**
 * Send the Clerk sign-up invitation. A failure is reported to the caller so
 * the UI can say so, but never blocks the seat being created: claiming works
 * off the verified email at first sign-in, so the person can still get in by
 * signing up manually with the invited address.
 */
async function sendInviteEmail(
  email: string,
): Promise<{ sent: boolean; invitationId: string | null }> {
  try {
    const invitation = await clerkClient.invitations.createInvitation({
      emailAddress: email,
      redirectUrl: inviteRedirectUrl(),
      notify: true,
      ignoreExisting: true,
    });
    return { sent: true, invitationId: invitation.id };
  } catch (err) {
    logger.error({ err, email }, "[team] failed to send Clerk invite email");
    return { sent: false, invitationId: null };
  }
}

router.get("/team", async (req, res): Promise<void> => {
  const caller = await getCaller(req);
  if (!caller.company) {
    res.json(ListTeamMembersResponse.parse([]));
    return;
  }
  const members = await db
    .select()
    .from(teamMembersTable)
    .where(eq(teamMembersTable.companyId, caller.company.id))
    .orderBy(teamMembersTable.id);
  res.json(ListTeamMembersResponse.parse(members.map(serializeMember)));
});

router.post("/team", async (req, res): Promise<void> => {
  const parsed = InviteTeamMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const caller = await getCaller(req);
  if (!caller.company) {
    res.status(404).json({ error: "No company yet" });
    return;
  }
  // Inviting someone hands out access to customer data and money movement, so
  // it stays with the owner rather than anyone holding a dispatcher seat.
  if (caller.role !== "owner") {
    res.status(403).json({ error: "Only the owner can invite team members" });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();

  const [existing] = await db
    .select()
    .from(teamMembersTable)
    .where(
      and(
        eq(teamMembersTable.companyId, caller.company.id),
        eq(teamMembersTable.email, email),
      ),
    )
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "That email is already on your team" });
    return;
  }

  const { sent, invitationId } = await sendInviteEmail(email);

  const [member] = await db
    .insert(teamMembersTable)
    .values({
      name: parsed.data.name,
      email,
      role: parsed.data.role,
      companyId: caller.company.id,
      status: "invited",
      clerkInvitationId: invitationId,
    })
    .returning();

  // A previously denied account may be this invitee refreshing the page; drop
  // the negative cache so they are let in on their next request.
  forgetDeniedCaller();

  await db.insert(activityTable).values({
    companyId: caller.company.id,
    type: "team_invited",
    message: sent
      ? `${parsed.data.name} was invited as a ${parsed.data.role}.`
      : `${parsed.data.name} was added as a ${parsed.data.role}, but the invite email could not be sent.`,
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
  const caller = await getCaller(req);
  if (!caller.company) {
    res.status(404).json({ error: "No company yet" });
    return;
  }
  if (caller.role !== "owner") {
    res.status(403).json({ error: "Only the owner can remove team members" });
    return;
  }

  const [target] = await db
    .select()
    .from(teamMembersTable)
    .where(
      and(
        eq(teamMembersTable.id, params.data.id),
        eq(teamMembersTable.companyId, caller.company.id),
      ),
    )
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }
  if (target.role === "owner") {
    res.status(400).json({ error: "The owner cannot be removed" });
    return;
  }

  await db.delete(teamMembersTable).where(eq(teamMembersTable.id, target.id));

  // Kill the emailed sign-up link too, so removing someone actually revokes
  // their way in rather than just deleting the row.
  if (target.clerkInvitationId) {
    try {
      await clerkClient.invitations.revokeInvitation(target.clerkInvitationId);
    } catch (err) {
      logger.error(
        { err, invitationId: target.clerkInvitationId },
        "[team] failed to revoke Clerk invitation",
      );
    }
  }

  res.sendStatus(204);
});

export default router;
