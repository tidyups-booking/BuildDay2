import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, companiesTable, teamMembersTable, activityTable } from "@workspace/db";
import {
  CreateCompanyBody,
  UpdateCompanyBody,
  GetCompanyResponse,
  CreateCompanyResponse,
  UpdateCompanyResponse,
  ConnectJobberResponse,
  DisconnectJobberResponse,
  SetJobberSkippedBody,
  SetJobberSkippedResponse,
  GoLiveResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { getCompanyForUser, serializeCompany } from "../lib/company";
import {
  getJobberCredentials,
  generatePkcePair,
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  fetchJobberAccount,
  disconnectJobberApp,
  getValidAccessToken,
  tokenExpiry,
} from "../lib/jobber";
import { encryptJobberToken } from "../lib/secretBox";
import { logger } from "../lib/logger";
import crypto from "node:crypto";

const router: IRouter = Router();

function externalBaseUrl(req: { get(name: string): string | undefined }): string {
  const proto = req.get("x-forwarded-proto")?.split(",")[0] || "https";
  const host = req.get("x-forwarded-host")?.split(",")[0] || req.get("host");
  return `${proto}://${host}`;
}

// OAuth callback — hit by a browser redirect from Jobber; identified by the
// `state` value we generated at connect time, not by a session.
router.get("/company/jobber/callback", async (req, res): Promise<void> => {
  const { code, state } = req.query as { code?: string; state?: string };
  // Build the absolute frontend URL from the incoming request's origin so the
  // redirect works regardless of which base path the frontend is mounted at.
  // The frontend's BASE_PATH is forwarded in X-Forwarded-Prefix by the proxy;
  // we fall back to FRONTEND_BASE_PATH env var, then to the root.
  const frontendBase =
    req.get("x-forwarded-prefix") ||
    process.env.FRONTEND_BASE_PATH ||
    "";
  const frontendOrigin = externalBaseUrl(req);
  const setupUrl = `${frontendOrigin}${frontendBase}/setup`;

  const fail = (reason: string) => {
    logger.warn({ reason }, "Jobber OAuth callback failed");
    res.redirect(`${setupUrl}?jobber_error=${encodeURIComponent(reason)}`);
  };

  if (!code || !state) {
    fail("Jobber did not return an authorization code.");
    return;
  }
  const [company] = await db
    .select()
    .from(companiesTable)
    .where(sql`${companiesTable.jobberOauth} ->> 'state' = ${state}`);
  if (!company || !company.jobberOauth) {
    fail("Unknown or expired connect attempt. Please try connecting again.");
    return;
  }

  try {
    const tokens = await exchangeAuthorizationCode({
      code,
      redirectUri: company.jobberOauth.redirectUri,
      codeVerifier: company.jobberOauth.verifier,
    });
    const account = await fetchJobberAccount(tokens.access_token);
    await db
      .update(companiesTable)
      .set({
        jobberConnected: true,
        // Connecting later overrides an earlier "skip" choice.
        jobberSkipped: false,
        jobberAccountId: account.id,
        jobberAccountName: account.name,
        // Tokens are encrypted at rest; decrypted only inside getValidAccessToken
        // and the disconnect flow — never returned to the browser.
        jobberAccessToken: encryptJobberToken(tokens.access_token),
        jobberRefreshToken: encryptJobberToken(tokens.refresh_token),
        jobberTokenExpiresAt: tokenExpiry(tokens.expires_in),
        jobberOauth: null,
        jobberNeedsReauth: false,
      })
      .where(eq(companiesTable.id, company.id));
    await db.insert(activityTable).values({
      companyId: company.id,
      type: "jobber_synced",
      message: `Jobber account "${account.name}" connected.`,
    });
    res.redirect(`${setupUrl}?jobber=connected`);
  } catch (err) {
    logger.error({ err }, "Jobber token exchange failed");
    fail("Could not complete the Jobber connection. Please try again.");
  }
});

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
  const creds = getJobberCredentials();
  if (!creds) {
    res.status(503).json({
      error:
        "Jobber API credentials are not configured. Add JOBBER_CLIENT_ID and JOBBER_CLIENT_SECRET first.",
    });
    return;
  }

  const state = crypto.randomBytes(24).toString("base64url");
  const { verifier, challenge } = generatePkcePair();
  const redirectUri = `${externalBaseUrl(req)}/api/company/jobber/callback`;

  await db
    .update(companiesTable)
    .set({
      jobberOauth: {
        state,
        verifier,
        redirectUri,
        createdAt: new Date().toISOString(),
      },
    })
    .where(eq(companiesTable.id, company.id));

  const authorizeUrl = buildAuthorizeUrl({
    clientId: creds.clientId,
    redirectUri,
    state,
    codeChallenge: challenge,
  });
  res.json(ConnectJobberResponse.parse({ authorizeUrl }));
});

router.post("/company/jobber/disconnect", async (req, res): Promise<void> => {
  const company = await getCompanyForUser(req.userId!);
  if (!company) {
    res.status(404).json({ error: "No company yet" });
    return;
  }

  if (company.jobberAccessToken) {
    try {
      const accessToken = await getValidAccessToken(company);
      await disconnectJobberApp(accessToken);
    } catch (err) {
      logger.warn({ err }, "Jobber appDisconnect failed; clearing tokens anyway");
    }
  }
  const [updated] = await db
    .update(companiesTable)
    .set({
      jobberConnected: false,
      jobberAccountName: null,
      jobberAccountId: null,
      jobberAccessToken: null,
      jobberRefreshToken: null,
      jobberTokenExpiresAt: null,
      jobberOauth: null,
      jobberNeedsReauth: false,
    })
    .where(eq(companiesTable.id, company.id))
    .returning();

  res.json(DisconnectJobberResponse.parse(await serializeCompany(updated!)));
});

// Jobber is optional. Skipping keeps the whole product usable — quotes,
// scheduling and bookings just live here instead of being pushed across.
router.post("/company/jobber/skip", async (req, res): Promise<void> => {
  const parsed = SetJobberSkippedBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const company = await getCompanyForUser(req.userId!);
  if (!company) {
    res.status(404).json({ error: "No company yet" });
    return;
  }
  // Skipping while connected would leave the UI claiming both at once.
  if (parsed.data.skipped && company.jobberConnected) {
    res.status(409).json({
      error: "Disconnect Jobber first if you want to run without it.",
    });
    return;
  }

  const [updated] = await db
    .update(companiesTable)
    .set({ jobberSkipped: parsed.data.skipped })
    .where(eq(companiesTable.id, company.id))
    .returning();

  res.json(SetJobberSkippedResponse.parse(await serializeCompany(updated!)));
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
