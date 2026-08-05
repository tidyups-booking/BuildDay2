---
name: Router-level guards leak across routers
description: Why role guards must be per-route in this API, never router.use()
---

All API sub-routers are mounted at the same base path, so every request flows through every sub-router until a route matches. A router-level `router.use(roleGuard)` inside one sub-router therefore runs for OTHER routers' routes mounted after it.

**Why:** an owner-only router-level guard once silently 403'd dispatchers and cleaners on every route mounted after that router — the whole app broke for non-owners.

**How to apply:** attach role guards per route, never via `router.use()`. The authorization matrix test suite pins this: it walks the live router and fails on any route missing an expectation, so add new routes to its matrix. Also check role before body validation when a handler does in-handler role checks, or blocked roles see 400 instead of 403.
