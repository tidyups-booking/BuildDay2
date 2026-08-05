import { Router, type IRouter } from "express";
import { eq, ne } from "drizzle-orm";
import { db, companiesTable, quoWebhooksTable } from "@workspace/db";
import {
  ConnectQuoResponse,
  DisconnectQuoResponse,
  ListQuoNumbersResponse,
  SelectQuoNumbersBody,
  SelectQuoNumbersResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { getCompanyForUser, serializeCompany } from "../lib/company";
import * as quo from "../lib/quo";
import { publicWebhookUrl } from "../lib/publicUrl";

const router: IRouter = Router();

router.use(requireAuth);

router.post("/company/quo/connect", async (req, res): Promise<void> => {
  const company = await getCompanyForUser(req.userId!);
  if (!company) {
    res.status(404).json({ error: "No company yet" });
    return;
  }
  if (!quo.getQuoApiKey()) {
    res.status(503).json({ error: "QUO_API_KEY is not configured" });
    return;
  }

  let numbers: quo.QuoPhoneNumber[];
  try {
    numbers = await quo.listPhoneNumbers();
  } catch (err) {
    req.log.error({ err: (err as Error).message }, "Quo connect failed");
    res.status(502).json({ error: "Could not reach Quo with the configured API key" });
    return;
  }

  const [updated] = await db
    .update(companiesTable)
    .set({
      quoConnected: true,
      quoWorkspaceName: `${numbers.length} line${numbers.length === 1 ? "" : "s"}`,
    })
    .where(eq(companiesTable.id, company.id))
    .returning();

  res.json(ConnectQuoResponse.parse(await serializeCompany(updated!)));
});

router.post("/company/quo/disconnect", async (req, res): Promise<void> => {
  const company = await getCompanyForUser(req.userId!);
  if (!company) {
    res.status(404).json({ error: "No company yet" });
    return;
  }

  const hooks = await db
    .select()
    .from(quoWebhooksTable)
    .where(eq(quoWebhooksTable.companyId, company.id));
  for (const hook of hooks) {
    try {
      await quo.deleteWebhook(hook.quoWebhookId);
    } catch (err) {
      req.log.warn(
        { err: (err as Error).message, id: hook.quoWebhookId },
        "Could not delete Quo webhook",
      );
    }
  }
  await db
    .delete(quoWebhooksTable)
    .where(eq(quoWebhooksTable.companyId, company.id));

  const [updated] = await db
    .update(companiesTable)
    .set({ quoConnected: false, quoWorkspaceName: null, quoNumberIds: [] })
    .where(eq(companiesTable.id, company.id))
    .returning();

  res.json(DisconnectQuoResponse.parse(await serializeCompany(updated!)));
});

router.get("/quo/numbers", async (req, res): Promise<void> => {
  const company = await getCompanyForUser(req.userId!);
  if (!company || !company.quoConnected) {
    res.json(ListQuoNumbersResponse.parse([]));
    return;
  }

  try {
    const numbers = await quo.listPhoneNumbers();
    res.json(
      ListQuoNumbersResponse.parse(
        numbers.map((n) => ({
          id: n.id,
          phoneNumber: n.number,
          name: n.name ?? n.number,
          watched: company.quoNumberIds.includes(n.id),
        })),
      ),
    );
  } catch (err) {
    req.log.error({ err: (err as Error).message }, "Quo number list failed");
    res.status(502).json({ error: "Could not load numbers from Quo" });
  }
});

router.post("/quo/numbers", async (req, res): Promise<void> => {
  const parsed = SelectQuoNumbersBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const company = await getCompanyForUser(req.userId!);
  if (!company) {
    res.status(404).json({ error: "No company yet" });
    return;
  }
  if (!company.quoConnected) {
    res.status(400).json({ error: "Connect Quo before choosing lines" });
    return;
  }

  const numberIds = parsed.data.numberIds;

  // A Quo line may only feed one company's dashboard. Without this check any
  // account on a shared workspace could subscribe itself to another tenant's
  // line and receive its call transcripts.
  const others = await db
    .select({
      id: companiesTable.id,
      name: companiesTable.name,
      numbers: companiesTable.quoNumberIds,
    })
    .from(companiesTable)
    .where(ne(companiesTable.id, company.id));

  const taken = numberIds.filter((id) =>
    others.some((o) => o.numbers.includes(id)),
  );
  if (taken.length > 0) {
    res.status(409).json({
      error: `${taken.length === 1 ? "That line is" : "Those lines are"} already connected to another account`,
    });
    return;
  }

  // Verify the ids are real lines in the workspace rather than arbitrary input.
  let workspaceNumbers: quo.QuoPhoneNumber[];
  try {
    workspaceNumbers = await quo.listPhoneNumbers();
  } catch (err) {
    req.log.error({ err: (err as Error).message }, "Quo number list failed");
    res.status(502).json({ error: "Could not load numbers from Quo" });
    return;
  }
  const known = new Set(workspaceNumbers.map((n) => n.id));
  const unknown = numberIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    res.status(400).json({ error: "Unknown Quo phone number" });
    return;
  }

  // Register the new subscriptions before tearing down the old ones, so a
  // failure leaves the company on its previous working setup rather than none.
  let created: quo.QuoWebhookRecord[] = [];
  if (numberIds.length > 0) {
    const url = publicWebhookUrl();
    const label = `bookmycleaning-${company.id}`;
    try {
      created = await Promise.all([
        quo.createCallWebhook(url, numberIds, `${label}-calls`),
        quo.createTranscriptWebhook(url, numberIds, `${label}-transcripts`),
        quo.createSummaryWebhook(url, numberIds, `${label}-summaries`),
      ]);
    } catch (err) {
      req.log.error(
        { err: (err as Error).message },
        "Could not register Quo webhooks",
      );
      // Roll back any hooks that did get created before the failure.
      await Promise.allSettled(
        created.map((w) => quo.deleteWebhook(w.id)),
      );
      res.status(502).json({
        error: "Quo rejected the webhook registration for these lines",
      });
      return;
    }
  }

  const previous = await db
    .select()
    .from(quoWebhooksTable)
    .where(eq(quoWebhooksTable.companyId, company.id));

  const [updated] = await db.transaction(async (tx) => {
    await tx
      .delete(quoWebhooksTable)
      .where(eq(quoWebhooksTable.companyId, company.id));
    if (created.length > 0) {
      await tx.insert(quoWebhooksTable).values(
        created.map((w) => ({
          companyId: company.id,
          quoWebhookId: w.id,
          signingKey: w.key,
          events: w.events,
          url: w.url,
        })),
      );
    }
    return tx
      .update(companiesTable)
      .set({ quoNumberIds: numberIds })
      .where(eq(companiesTable.id, company.id))
      .returning();
  });

  // Old hooks are only removed once the new ones are committed. A failure here
  // leaves a harmless duplicate on Quo's side rather than a gap in coverage.
  for (const hook of previous) {
    try {
      await quo.deleteWebhook(hook.quoWebhookId);
    } catch (err) {
      req.log.warn(
        { err: (err as Error).message, id: hook.quoWebhookId },
        "Could not delete superseded Quo webhook",
      );
    }
  }

  res.json(SelectQuoNumbersResponse.parse(await serializeCompany(updated!)));
});

export default router;
