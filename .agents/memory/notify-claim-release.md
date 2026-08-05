---
name: Owner-notify claim release
description: Best-effort notifications report an outcome; retry state must stay separate from health flags.
---

Best-effort notification helpers return an outcome ("sent" | "skipped" | "failed") instead of void.

**Why:** A one-per-transition notification (e.g. an outage text) needs a retry when the send fails transiently, but must not retry forever on config gaps (no number configured). And crucially, retry bookkeeping must never be modeled by toggling the underlying health/state flag itself — clearing a health flag to "release a claim" makes dashboards report an ongoing outage as healthy.

**How to apply:** Return the tri-state outcome; retry only on "failed"; keep retry/claim state in its own column or mechanism, independent of the health flag the dashboard reads.
