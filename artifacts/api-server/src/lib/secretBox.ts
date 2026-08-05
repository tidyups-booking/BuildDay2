import crypto from "node:crypto";

/**
 * Symmetric encryption for third-party credentials we have to store and replay
 * (currently each company's Quo API key). Quo has no OAuth flow, so the raw key
 * is the only way to call their API on a company's behalf — it must never sit
 * in the database in plaintext.
 *
 * The encryption key is derived from SESSION_SECRET via HKDF with a distinct
 * info label, so it is cryptographically independent of the session signing key
 * even though it shares a root secret.
 *
 * Rotating SESSION_SECRET invalidates every stored credential: companies would
 * have to reconnect Quo. `decryptSecret` returns null rather than throwing so
 * that case surfaces as "reconnect Quo" instead of a crash.
 */
const INFO = "bookmycleaning:quo-api-key:v1";
const VERSION = "v1";

let cachedKey: Buffer | null = null;

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const root = process.env.SESSION_SECRET?.trim();
  if (!root) {
    throw new Error(
      "SESSION_SECRET is required to encrypt stored Quo credentials",
    );
  }
  cachedKey = Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(root, "utf8"), Buffer.alloc(0), INFO, 32),
  );
  return cachedKey;
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ct = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(".");
}

export function decryptSecret(payload: string | null): string | null {
  if (!payload) return null;
  const [version, ivB64, tagB64, ctB64] = payload.split(".");
  if (version !== VERSION || !ivB64 || !tagB64 || !ctB64) return null;

  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key or tampered ciphertext.
    return null;
  }
}

/** Last four characters, for showing which key is connected without leaking it. */
export function maskKey(key: string): string {
  return key.length <= 4 ? "****" : `****${key.slice(-4)}`;
}
