---
name: Owner-notify claim release
description: Best-effort notifications report an outcome; claims are released only on transient send failures, never on config skips.
---

Best-effort notification helpers return an outcome ("sent" | "skipped" | "failed") instead of void.

**Why:** Callers that claim a one-per-transition notification (e.g. the quoNeedsReauth flag flip) must release the claim when the send itself fails transiently, or the one-per-outage text is permanently swallowed. But releasing on *config-gap* skips (no ring-through number, no platform key) would retry forever and keep the state flag inaccurate for the dashboard.

**How to apply:** When adding a new best-effort notification tied to a claimed state transition, return the tri-state outcome and release the claim (conditional update back) only on "failed". Log a warn on release so admins can see it.
