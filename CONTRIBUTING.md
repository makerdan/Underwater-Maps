# Contributing to BathyScan

## Quality gates

Every pull request must pass all four checks before merging.

| Command | What it does |
|---------|--------------|
| `pnpm run typecheck` | Full workspace TypeScript check (strict mode) |
| `pnpm run lint` | ESLint across `bathyscan/src` and `api-server/src` |
| `pnpm run test:unit` | Vitest unit tests in all packages |
| `pnpm run test:e2e` | Playwright smoke suite against the running app |
| `pnpm run test-all` | Runs typecheck + lint + test:unit in sequence |

Run any single command from the workspace root (`/`).

---

## Unit tests

### Where to put them

Place test files next to the code they exercise, inside a `__tests__/` directory:

```
artifacts/bathyscan/src/lib/__tests__/colormap.test.ts   ← frontend utilities
artifacts/api-server/src/__tests__/parser.test.ts        ← backend utilities
```

### How to write a unit test

```ts
// artifacts/bathyscan/src/lib/__tests__/myUtil.test.ts
import { describe, it, expect, vi } from "vitest";
import { myUtility } from "../myUtil";

// Mock heavy deps (Three.js, DB) — no GPU or real DB needed in unit tests
vi.mock("three", () => ({ Color: class { /* ... */ } }));

describe("myUtility", () => {
  it("returns the expected value for input X", () => {
    expect(myUtility("X")).toBe("expected");
  });
});
```

Run only the frontend tests:

```bash
pnpm --filter @workspace/bathyscan run test:unit
```

Run only the API server tests:

```bash
pnpm --filter @workspace/api-server run test:unit
```

### Rule

> **Every task that adds a feature must add at least one unit test for it.**

---

## End-to-end (E2E) tests

E2E tests live in `tests/e2e/` and run against the real dev server.

### Writing an E2E test

```ts
// tests/e2e/my-feature.spec.ts
import { test, expect } from "@playwright/test";

test("my feature works end-to-end", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const el = page.locator("text=My Feature");
  await expect(el).toBeVisible();
});
```

### Running E2E tests

The Playwright config (`playwright.config.ts`) starts the dev server automatically.

```bash
pnpm run test:e2e
```

To run a single spec:

```bash
pnpm exec playwright test tests/e2e/smoke.spec.ts
```

> **Note:** Playwright requires Chromium to be installed. In the Replit environment, run `pnpm exec playwright install chromium` once after cloning. The sandbox server (port 3150) must not be blocked by a firewall rule.

---

## Substrate / EFH bundle maintenance

The API server ships several pre-generated data bundles (substrate polygons, EFH zones, terrain grids) under `artifacts/api-server/src/lib/*.gen.json`. Each bundle embeds a `metadata.generatorHash` field — the SHA-256 of the builder script that produced it.

The test `src/__tests__/substrate-bundles-generator-hash.test.ts` recomputes this hash on every CI run. **If you edit a builder script without re-running it, that test will fail with a "Generator-hash drift" error** and tell you exactly which bundle needs refreshing.

### When to regenerate

Regenerate any bundle whose builder script you edit:

| Bundle | Refresh command |
|--------|-----------------|
| `shoreZoneData.alaska.gen.json` | `pnpm --filter @workspace/scripts run build-shorezone` |
| `encSubstrateData.alaska.gen.json` | `pnpm --filter @workspace/scripts run build-enc-substrate` |
| `usSeabedSubstrate.gen.json` | `pnpm --filter @workspace/scripts run build-usseabed-substrate` |
| `txLakeSubstrate.gen.json` | `pnpm --filter @workspace/scripts run build-tx-lake-substrate` |
| `txFreshwaterEfhData.gen.json` | `pnpm --filter @workspace/scripts run build-tx-freshwater-efh` |
| `lakeRayRobertsTerrain.gen.json` | `pnpm --filter @workspace/scripts run build-lake-ray-roberts-terrain` |

Run the command from the workspace root, then **commit the updated `.gen.json` file** alongside your script change. The hash-drift test is the automated guard that catches bundles left out of sync.

---

## TypeScript conventions

- Strict mode is enforced (`"strict": true`, `"noUncheckedIndexedAccess": true`).
- Never use `any` — use `unknown` and narrow with type guards.
- Use `!` non-null assertions only when the value is guaranteed by invariant; add a comment explaining why.
- Array index reads (`arr[i]`) return `T | undefined` — always guard with `?? default` or `!` + comment.
