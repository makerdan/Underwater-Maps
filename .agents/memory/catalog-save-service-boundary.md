---
name: Catalog save service boundary
description: Background catalog-save persistence should stay behind the domain service while provider builders remain lazily resolved.
---

The catalog-save domain service owns background-job orchestration, persistence, cancellation guards, retry cleanup, and failure reporting. Provider-specific grid construction may be loaded lazily to avoid route initialization cycles, while compatibility exports can preserve focused route-test imports.

**Why:** Save jobs are fire-and-forget and touch multiple ownership and orphan-prevention paths; keeping that lifecycle outside HTTP route handlers makes future retry and cleanup changes safer without changing endpoint behavior.

**How to apply:** When changing catalog save materialization, route POST/retry handlers through the domain service and preserve the integration/orphan-cleanup assertions before changing public routes.