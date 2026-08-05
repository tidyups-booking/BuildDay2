/**
 * The externally reachable base URL for this server.
 *
 * In the workspace this is the `.replit.dev` dev domain; once published,
 * REPLIT_DOMAINS carries the production hostname. Quo requires an HTTPS URL it
 * can reach, so localhost is never valid here.
 */
export function publicBaseUrl(): string {
  const domains = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  const dev = process.env.REPLIT_DEV_DOMAIN?.trim();
  const host = domains || dev;
  if (!host) {
    throw new Error("No public domain available for webhook registration");
  }
  return `https://${host}`;
}

export function publicWebhookUrl(): string {
  return `${publicBaseUrl()}/api/webhooks/quo`;
}
