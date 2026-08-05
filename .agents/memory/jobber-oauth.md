---
name: Jobber OAuth PKCE flow
description: How Jobber OAuth 2.0 + PKCE is implemented, including token encryption at rest.
---

## Rule
Jobber uses real OAuth 2.0 + PKCE. Tokens are AES-256-GCM encrypted at rest using `encryptJobberToken`/`decryptJobberToken` from `secretBox.ts` (info label `bookmycleaning:jobber-token:v1`). Never store or return raw Jobber tokens from the DB.

**Why:** Jobber access and refresh tokens are durable OAuth credentials — plaintext storage exposes them in any DB read or backup compromise.

**How to apply:**
- `POST /api/company/jobber/connect` → generates PKCE pair + state, stores in `companies.jobber_oauth` (JSONB), returns `{ authorizeUrl }` — frontend redirects the browser to Jobber.
- Jobber redirects to `GET /api/company/jobber/callback` (unauthenticated) → matches state to company via `jobber_oauth->>'state'`, exchanges code for tokens, calls `encryptJobberToken` before storing.
- `getValidAccessToken(company)` in `artifacts/api-server/src/lib/jobber.ts` → calls `decryptJobberToken` on stored values, auto-refreshes if within 60s of expiry, re-encrypts updated tokens.
- Disconnect: calls Jobber's `appDisconnect` mutation with a decrypted token, then nulls all token columns.
- The OAuth callback URL registered in Jobber Developer Center must be `https://<domain>/api/company/jobber/callback`.
- `JOBBER_CLIENT_ID` and `JOBBER_CLIENT_SECRET` must be set as secrets.
