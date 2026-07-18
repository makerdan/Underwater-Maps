import { test as base, expect } from "@playwright/test";
import { E2E_API_URL, E2E_RUN_SUFFIX } from "./ports";
import type { Page, Locator, APIRequestContext, APIResponse } from "@playwright/test";

/**
 * Shared Playwright fixtures for the BathyScan e2e suite.
 *
 * The suite shares a single dev-bypass user (dev-user-bypass) across all
 * specs. If a test crashes before its own cleanup step, the next spec
 * inherits whatever state was left behind — wrong units, hidden minimap,
 * wrong waterType, etc. — and fails for an unrelated reason.
 *
 * The `resetSettings` fixture runs automatically before every test (auto:
 * true). It issues a single PUT /api/settings with the complete set of
 * default values that specs care about, so each spec starts from a clean
 * baseline without duplicating the reset logic.
 *
 * If the API server is unreachable (e.g. during isolated settings-only runs
 * where the server process was not started), the fixture logs a warning and
 * proceeds rather than hard-failing every test. Settings-only specs rely on
 * localStorage (Zustand persist), so they remain valid without server resets.
 *
 * ─── USER IDENTITY RULE ────────────────────────────────────────────────────
 * Never write a raw user-ID string literal ("e2e-user", "dev-user-bypass",
 * etc.) in any spec file. Always import and use the E2E_USER_ID constant
 * exported from this file:
 *
 *   import { E2E_USER_ID, test, expect } from "./fixtures";
 *
 * The post-merge lint step runs scripts/check-e2e-user-ids.sh, which greps
 * every tests/e2e/**‌/*.ts file for quoted strings matching the "*-user*"
 * pattern and exits non-zero if any are found outside this file. A raw
 * string literal that diverges from the actual bypass identity causes silent
 * auth failures in DELETE / PUT calls — the very bug this constant prevents.
 * ───────────────────────────────────────────────────────────────────────────
 */

export const API_URL = process.env["E2E_API_BASE_URL"] ?? E2E_API_URL;

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

// Per-suite bypass identity. A suite relocated onto its own ports (e.g. the
// palette workflow sets E2E_API_PORT=3261) automatically gets a distinct
// user id so it never shares server-side settings rows with a concurrently
// running default-port suite — two suites PUTting /api/settings as the same
// user clobber each other and produce phantom sync failures. Explicitly
// overridable via E2E_USER_ID. playwright.config.ts imports this constant and
// passes it to the frontend webServer as VITE_E2E_USER_ID so the browser-side
// header injection uses the same identity.
export const E2E_USER_ID =
  process.env["E2E_USER_ID"] ?? `dev-user-bypass${E2E_RUN_SUFFIX}`;

export const DEFAULT_SETTINGS = {
  units: "metric",
  waterType: "saltwater",
  colormapTheme: "ocean",
  showCompassMinimap: true,
  hasSeenOnboarding: true,
  hasSeenToolbarRelocationHint: true,
  // sidebarMode persists server-side per user; a spec that switches to Plan
  // (or Live) would otherwise leak that mode into the next spec, hiding the
  // Explore tab's DatasetPanel and breaking remove-dataset flows.
  sidebarMode: "explore",
  panelCollapse: {},
} as const;

// ─── Layer 3: per-spec-file wall-clock budget guard ─────────────────────────
// Budgets live in tests/timeout-guard/budgets.json (e2e.fileBudgetMs). With
// workers: 1 the suite runs files sequentially, so we track cumulative
// elapsed time per spec file and fail the file's remaining tests fast with a
// diagnostic instead of letting a slow file consume the whole run budget.
import budgets from "../timeout-guard/budgets.json";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

const fileStarts = new Map<string, number>();
const fileSlowest = new Map<string, Array<{ name: string; durationMs: number }>>();

export const test = base.extend<{ resetSettings: void; fileBudgetGuard: void; suppressOnboarding: void }>({
  // The full-screen OnboardingOverlay (zIndex 9000) renders from the
  // localStorage-persisted client store BEFORE the server settings hydrate,
  // so the server-side hasSeenOnboarding reset above is not enough — the
  // overlay intercepts pointer events during the first seconds of every
  // test. Seed localStorage before any page script runs. Specs that need
  // the overlay (onboarding-tour.spec.ts) register their own init script
  // later, which runs after this one and overwrites the value.
  suppressOnboarding: [
    async ({ page }, use) => {
      await page.addInitScript(() => {
        try {
          const raw = localStorage.getItem("bathyscan:settings");
          const parsed: { state?: Record<string, unknown>; version?: number } =
            raw ? JSON.parse(raw) : {};
          parsed.state = { ...(parsed.state ?? {}), hasSeenOnboarding: true };
          localStorage.setItem("bathyscan:settings", JSON.stringify(parsed));
        } catch {
          try {
            localStorage.setItem(
              "bathyscan:settings",
              JSON.stringify({ state: { hasSeenOnboarding: true }, version: 0 }),
            );
          } catch {}
        }
      });
      await use();
    },
    { auto: true },
  ],
  fileBudgetGuard: [
    async ({}, use, testInfo) => {
      const file = testInfo.file;
      if (!fileStarts.has(file)) fileStarts.set(file, Date.now());
      const start = fileStarts.get(file)!;
      const budgetMs = budgets.e2e.fileBudgetMs;
      const elapsedMs = Date.now() - start;
      if (elapsedMs > budgetMs) {
        const slowest = (fileSlowest.get(file) ?? []).slice(0, 5);
        const lines = [
          "",
          "════════════════════════════════════════════════════════════════",
          "⏱  TEST TIME-BUDGET BREACH — layer: FILE (e2e)",
          `Offender : ${file}`,
          `Elapsed  : ${(elapsedMs / 1000).toFixed(1)}s  (budget: ${(budgetMs / 1000).toFixed(1)}s)`,
          "Slowest tests in this file so far:",
          ...slowest.map((s) => `  - ${(s.durationMs / 1000).toFixed(1)}s  ${s.name}`),
          "Suggestions:",
          "  • Raise e2e.fileBudgetMs in tests/timeout-guard/budgets.json only if this spec legitimately needs more time.",
          "  • Check for slow selectors, long waitForTimeout calls, or network waits against live NOAA endpoints.",
          "════════════════════════════════════════════════════════════════",
          "",
        ];
        console.error(lines.join("\n"));
        try {
          const dir = resolvePath(process.cwd(), ".local/test-timeout-reports");
          mkdirSync(dir, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          writeFileSync(
            resolvePath(dir, `${stamp}-file.json`),
            JSON.stringify({ layer: "file", name: file, elapsedMs, budgetMs, slowest, at: new Date().toISOString() }, null, 2),
          );
        } catch {
          // reporting must never mask the primary failure
        }
        throw new Error(
          `[timeout-guard] Spec file exceeded its ${(budgetMs / 1000).toFixed(0)}s wall-clock budget ` +
            `(elapsed ${(elapsedMs / 1000).toFixed(1)}s). See diagnostic above.`,
        );
      }
      const testStart = Date.now();
      await use();
      const list = fileSlowest.get(file) ?? [];
      list.push({ name: testInfo.title, durationMs: Date.now() - testStart });
      list.sort((a, b) => b.durationMs - a.durationMs);
      if (list.length > 5) list.length = 5;
      fileSlowest.set(file, list);
    },
    { auto: true },
  ],
  resetSettings: [
    async ({ request }, use) => {
      try {
        await request.put(`${API_URL}/api/settings`, {
          headers: { "x-e2e-user-id": E2E_USER_ID },
          data: DEFAULT_SETTINGS,
        });
      } catch (err) {
        // The API server may not be running during isolated settings-only
        // runs. Settings specs read localStorage directly, so this is safe
        // to skip — log a warning and continue.
        console.warn(
          `[resetSettings] API server unreachable at ${API_URL} — skipping server-side reset (${(err as Error).message})`,
        );
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect };
export type { Page, Locator, APIRequestContext, APIResponse };
