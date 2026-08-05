# Book My Cleaning (by Tidyups)

A multi-company SaaS: an AI phone receptionist for cleaning companies that use Jobber. Companies sign up, connect Jobber, connect their existing Quo (formerly OpenPhone) workspace and choose which lines the AI answers, customize the receptionist (greeting, collected fields, custom Q&A, services/prices), invite their team, and get a dispatcher dashboard where calls become transcripts and bookings that sync to Jobber.

## Status

Telephony is **real**: the app reads calls, Sona transcripts, and summaries from the customer's own Quo workspace. We never provision phone numbers — there is no Twilio dependency.

Jobber OAuth is still **simulated** server-side (drop-in replaceable). Test calls generate realistic transcripts from the company's receptionist configuration.

### Quo integration

- Auth is a workspace API key in `QUO_API_KEY` (raw value in the `Authorization` header — no `Bearer` prefix). Today one key serves the first customer; per-company keys are the next step for true multi-tenancy.
- `POST /api/company/quo/connect` verifies the key, `GET/POST /api/quo/numbers` lists the workspace's real lines and records which ones the receptionist watches.
- Selecting lines registers three webhooks with Quo (calls, transcripts, summaries) pointing at `/api/webhooks/quo`. Their `whsec_...` signing keys are stored in `quo_webhooks`, because Quo only returns each key at creation time.
- The webhook receiver verifies the svix-style HMAC signature against the **raw** request body. Its raw parser is mounted on the exact webhook path only — see `.agents/memory/express-raw-body-scope.md` for why a broader mount breaks every other route.
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
