# Book My Cleaning (by Tidyups)

A multi-company SaaS: an AI phone receptionist for cleaning companies that use Jobber. Companies sign up, connect Jobber, connect their existing Quo (formerly OpenPhone) workspace and choose which lines the AI answers, customize the receptionist (greeting, collected fields, custom Q&A, services/prices), invite their team, and get a dispatcher dashboard where calls become transcripts and bookings that sync to Jobber.

## Status

Telephony is **real**: the app reads calls, Sona transcripts, and summaries from the customer's own Quo workspace. We never provision phone numbers — there is no Twilio dependency.

Jobber OAuth is still **simulated** server-side (drop-in replaceable). Test calls generate realistic transcripts from the company's receptionist configuration.

### Quo integration

- Each company connects **their own** Quo workspace. Quo has no OAuth flow, so the owner pastes a workspace API key (Quo settings → API) which is stored AES-256-GCM encrypted in `companies.quo_api_key_encrypted`; only the last four characters are ever returned to the browser. The encryption key is derived from `SESSION_SECRET` via HKDF, so rotating that secret forces every company to reconnect.
- Every Quo client function takes the calling company's key as its first argument — there is no shared fallback, so one tenant's key can never serve another's request. The `QUO_API_KEY` secret is only for local scripts and manual probing.
- Quo's Starter plan does **not** include AI call transcripts or summaries; companies need the Business plan for this product to work. Sona calls also consume credits (1 call = 100; 1,000 credits included per plan).
- `POST /api/company/quo/connect` validates the pasted key against Quo before storing it, `GET/POST /api/quo/numbers` lists the workspace's real lines and records which ones the receptionist watches. A line already claimed by another company is rejected with 409.
- Selecting lines registers three webhooks with Quo (calls, transcripts, summaries) pointing at `/api/webhooks/quo`. Their `whsec_...` signing keys are stored in `quo_webhooks`, because Quo only returns each key at creation time.
- The webhook receiver verifies the svix-style HMAC signature against the **raw** request body. Its raw parser is mounted on the exact webhook path only — see `.agents/memory/express-raw-body-scope.md` for why a broader mount breaks every other route.
- Deliveries are idempotent: each `webhook-id` is claimed in `quo_webhook_deliveries` before processing, so replays and retries of an already-handled event are acknowledged without side effects. Processing happens **before** the response — success returns 200, failure releases the claim and returns 500 so Quo retries. Events for a line the matched company does not watch are ignored.
- Transcripts are **post-call**, not live. `call.ringing` shows a call in progress; the transcript arrives seconds after hangup via `call.transcript.completed`.
- `POST /api/calls/sync` backfills history, since webhooks only cover calls made after setup.

## Architecture

pnpm monorepo:
- `artifacts/book-my-cleaning` — React/Vite frontend at `/` (landing, Clerk sign-in/up, onboarding, `/setup` wizard, dashboard, calls, bookings, team, settings)
- `artifacts/api-server` — Express 5 API at `/api`; Clerk auth (proxy middleware + `requireAuth` via `getAuth`); all data scoped to the company owned by the Clerk userId
- `lib/api-spec/openapi.yaml` — API contract; codegen produces `lib/api-zod` (server validation) and `lib/api-client-react` (React Query hooks)
- `lib/db` — Drizzle/Postgres: companies, services, team_members, calls (jsonb transcript/answers), bookings, activity

## Auth

Replit-managed Clerk. Clerk Organizations are NOT available — companies/roles live in our own DB keyed by Clerk userId. Web auth is cookie-based (no bearer tokens in browser code).

## Conventions

- Change the API by editing `openapi.yaml`, then `pnpm --filter @workspace/api-spec run codegen` (the script rewrites the zod import to `zod/v4` — orval emits zod v4 API).
- Schema changes: `pnpm --filter @workspace/db run push`.

## User preferences

(none recorded yet)
