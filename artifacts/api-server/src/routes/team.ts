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
import { findBlockedEmails } from "../lib/seatAffiliation";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.use(requireAuth);

function serializeMember(
  m: typeof teamMembersTable.$inferSelect,
  blockedByOtherCompany = false,
) {
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
    // True when this invite can never be accepted because the address is
    // already attached to another company (one login = one company).
    blockedByOtherCompany,
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

router.get(
  "/team",
  requireRole("owner", "dispatcher"),
  async (req, res): Promise<void> => {
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

    // Label invites that can never be accepted because the address already
    // belongs to someone attached to another company, so the owner can act
    // (remove the seat and invite a different address) instead of waiting.
    const pendingEmails = members
      .filter((m) => m.clerkUserId === null && m.role !== "owner")
      .map((m) => m.email);
    const blocked = await findBlockedEmails(pendingEmails);

    res.json(
      ListTeamMembersResponse.parse(
        members.map((m) =>
          serializeMember(
            m,
            m.clerkUserId === null && blocked.has(m.email.trim().toLowerCase()),
          ),
        ),
      ),
    );
  },
);

router.post(
  "/team",
  requireRole("owner", "dispatcher"),
  async (req, res): Promise<void> => {
    // Inviting someone hands out access to customer data and money movement,
    // so it stays with the owner rather than anyone holding a dispatcher seat.
    // Checked before anything else so a non-owner always gets 403, not a
    // validation error that suggests retrying might work.
    const caller = await getCaller(req);
    if (caller.role !== "owner") {
      res.status(403).json({ error: "Only the owner can invite team members" });
      return;
    }
    const parsed = InviteTeamMemberBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (!caller.company) {
      res.status(404).json({ error: "No company yet" });
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

    // Block up front rather than letting the invite hang forever: a login can
    // only belong to one company, so an address already attached elsewhere can
    // never accept this invite.
    const blocked = await findBlockedEmails([email]);
    if (blocked.has(email)) {
      res.status(409).json({
        error:
          "That address already has a login with another company. A login can only belong to one company — ask them for a different email address to use here.",
      });
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
  },
);

router.delete(
  "/team/:id",
  requireRole("owner", "dispatcher"),
  async (req, res): Promise<void> => {
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
        await clerkClient.invitations.revokeInvitation(
          target.clerkInvitationId,
        );
      } catch (err) {
        logger.error(
          { err, invitationId: target.clerkInvitationId },
          "[team] failed to revoke Clerk invitation",
        );
      }
    }

    res.sendStatus(204);
  },
);

export default router;
