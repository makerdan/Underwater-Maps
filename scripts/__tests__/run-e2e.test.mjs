import assert from "node:assert/strict";
import test from "node:test";
import { buildPlaywrightRunArgs } from "../run-e2e.mjs";

test("run-e2e preserves Playwright file and filter arguments", () => {
  const filter = "offline badge|query panel|dataset picker";
  assert.deepEqual(
    buildPlaywrightRunArgs([
      "--",
      "tests/e2e/pwa-offline.spec.ts",
      "--grep",
      filter,
      "--project",
      "chromium",
    ]),
    [
      "e2e",
      "--label",
      "playwright e2e",
      "--",
      "playwright",
      "test",
      "tests/e2e/pwa-offline.spec.ts",
      "--grep",
      filter,
      "--project",
      "chromium",
    ],
  );
});