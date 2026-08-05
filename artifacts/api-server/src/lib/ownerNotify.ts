/**
 * Direct owner notifications, sent from the platform's own Quo workspace.
 *
 * These fire when something breaks that the owner would otherwise only
 * discover by opening the dashboard — most importantly a dead Quo key. The
 * company's own key is exactly what stopped working in that case, so the text
 * goes out over the platform's Quo workspace (QUO_API_KEY env secret), never
 * the company's key.
 *
 * All functions here are best-effort: they log failures and never throw, so a
 * notification hiccup can't break the health check or a webhook handler.
 */
import type { Company } from "@workspace/db";
import { listPhoneNumbers, sendMessage, toE164 } from "./quo";
import { publicBaseUrl } from "./publicUrl";
import { logger } from "./logger";

/** The platform workspace's key — unrelated to any company's connected key. */
function platformQuoKey(): string | null {
  return process.env.QUO_API_KEY?.trim() || null;
}

/**
 * The platform number notifications are sent from: the first number in the
 * platform's Quo workspace. Cached after the first successful lookup — the
 * workspace's numbers don't churn.
 */
let cachedFromNumber: string | null = null;
async function platformFromNumber(apiKey: string): Promise<string | null> {
  if (cachedFromNumber) return cachedFromNumber;
  const numbers = await listPhoneNumbers(apiKey);
  cachedFromNumber = numbers[0]?.number ?? null;
  return cachedFromNumber;
}

/** Absolute link to the setup page, valid outside any HTTP request. */
function setupPageUrl(): string {
  const base = process.env.FRONTEND_BASE_PATH || "";
  return `${publicBaseUrl()}${base}/setup`;
}

/**
 * Text the owner (at the company's ring-through number) that their Quo key
 * stopped working, with a link back to setup to reconnect.
 *
 * Callers are responsible for only invoking this on an actual
 * healthy → needs-reauth transition (setQuoNeedsReauth does this via its
 * conditional update), so the owner gets one text per outage, not one per
 * hourly check.
 */
export async function notifyOwnerQuoKeyDead(company: Company): Promise<void> {
  try {
    const apiKey = platformQuoKey();
    if (!apiKey) {
      logger.warn(
        { companyId: company.id },
        "Quo key dead but QUO_API_KEY is not set; owner not notified",
      );
      return;
    }
    const to = company.ringThroughNumber
      ? toE164(company.ringThroughNumber)
      : null;
    if (!to) {
      logger.warn(
        { companyId: company.id },
        "Quo key dead but company has no usable ring-through number; owner not notified",
      );
      return;
    }
    const from = await platformFromNumber(apiKey);
    if (!from) {
      logger.warn(
        { companyId: company.id },
        "Quo key dead but the platform Quo workspace has no phone number; owner not notified",
      );
      return;
    }
    await sendMessage(apiKey, {
      from,
      to,
      content:
        `Heads up from Book My Cleaning: the Quo connection for ${company.name} stopped working, ` +
        `so calls and texts aren't being handled. Reconnect here: ${setupPageUrl()}`,
    });
    logger.info(
      { companyId: company.id },
      "Owner notified that their Quo key stopped working",
    );
  } catch (err) {
    // Best-effort only — never let a notification failure break the caller.
    logger.error(
      { companyId: company.id, err },
      "Failed to notify owner about dead Quo key",
    );
  }
}
