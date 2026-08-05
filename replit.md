# Book My Cleaning (by Tidyups)

A multi-company SaaS: an AI phone receptionist for cleaning companies that use Jobber. Companies sign up, connect Jobber, pick a phone number, customize the receptionist (greeting, collected fields, custom Q&A, services/prices), invite their team, and get a dispatcher dashboard where calls become transcripts and bookings that sync to Jobber.

## Status

MVP skeleton — end-to-end flows work, but Jobber OAuth and Twilio phone provisioning are **simulated** server-side (drop-in replaceable once real API keys exist). Test calls generate realistic transcripts from the company's receptionist configuration.

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
