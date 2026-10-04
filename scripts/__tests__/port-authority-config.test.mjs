import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CANONICAL_RUN_BUTTON_COMMAND, parseReplitWorkflows } from "../check-runbutton-noop.mjs";
import { VALIDATION_COMMANDS } from "../register-validation-commands.mjs";
import { getValidationSteps } from "../validation-steps.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (relativePath) => readFileSync(resolve(root, relativePath), "utf8");
const budgets = JSON.parse(read("tests/timeout-guard/budgets.json"));

test(".replit keeps Project isolated from the four registered validation workflows", () => {
  const { runButton, workflows } = parseReplitWorkflows(read(".replit"));
  const tierCommands = VALIDATION_COMMANDS.filter(({ budgetKey }) => budgetKey !== null);
  assert.equal(runButton, "Project");
  assert.deepEqual(
    workflows.map(({ name }) => name).sort(),
    ["Project", ...tierCommands.map(({ name }) => name)].sort(),
    "no duplicate or unregistered workflows should consume slots",
  );
  const project = workflows.find(({ name }) => name === runButton);
  assert.equal(project.mode, "sequential");
  assert.deepEqual(project.tasks, [
    { task: "shell.exec", args: CANONICAL_RUN_BUTTON_COMMAND },
  ]);
  for (const { name, command } of tierCommands) {
    const workflow = workflows.find((candidate) => candidate.name === name);
    assert.equal(workflow.isValidation, true, `${name} must be registered as a validation check`);
    assert.doesNotMatch(
      workflow.tasks[0]?.args ?? "",
      /--allow-no-plan/,
      `${name} must retain its existing independent invocation without a bypass flag`,
    );
    assert.deepEqual(
      workflow.tasks,
      [{ task: "shell.exec", args: command }],
      `${name} must keep its registered command unchanged`,
    );
  }
});

test("validation manifest is the exact five-command registration contract", () => {
  assert.deepEqual(
    VALIDATION_COMMANDS.map(({ name }) => name),
    ["test-fast", "test-standard", "test-standard-plus", "test-heavy", "audit-marker-bbox"],
  );

  const commands = Object.fromEntries(
    VALIDATION_COMMANDS.map(({ name, command }) => [name, command]),
  );
  assert.equal(
    commands["test-fast"],
    "node scripts/run-with-timeout.mjs tierFast -- node scripts/run-tier.mjs fast",
  );
  assert.equal(
    commands["test-standard"],
    "node scripts/run-with-timeout.mjs tierStandard -- node scripts/run-tier.mjs standard",
  );
  assert.equal(
    commands["test-standard-plus"],
    "node scripts/run-with-timeout.mjs tierStandardPlus -- node scripts/run-tier.mjs full",
  );
  assert.equal(
    commands["test-heavy"],
    "node scripts/run-with-timeout.mjs aggregate --owns-e2e-ports -- node scripts/test-heavy-serial.mjs",
  );
  assert.equal(
    commands["audit-marker-bbox"],
    "pnpm --filter @workspace/db audit:marker-bbox -- --ci",
  );
  assert.equal(
    VALIDATION_COMMANDS.filter(({ budgetKey }) => budgetKey !== null).length,
    4,
  );
});

test("heavy routing stays serialized and does not add an outer lock", () => {
  const manifest = read("scripts/register-validation-commands.mjs");
  const heavySource = read("scripts/test-heavy-serial.mjs");
  const packageScripts = JSON.parse(read("package.json")).scripts;
  assert.match(manifest, /name: "test-heavy"[\s\S]*test-heavy-serial\.mjs/);
  assert.doesNotMatch(
    VALIDATION_COMMANDS.find(({ name }) => name === "test-heavy").command,
    /validation-lock\.mjs/,
  );
  assert.match(
    VALIDATION_COMMANDS.find(({ name }) => name === "test-heavy").command,
    /--owns-e2e-ports/,
  );
  assert.match(heavySource, /PLAYWRIGHT_CI_SUITE=main-full/);
  assert.match(heavySource, /PLAYWRIGHT_CI_RESULTS=/);
  assert.match(heavySource, /ci-playwright-reporter\.mjs/);
  assert.match(heavySource, /check-e2e-runtime-skips\.mjs/);
  assert.match(heavySource, /runtime-skip-baseline\.json/);
  assert.match(heavySource, /exit \$\(\(status \|\| checker\)\)/);
  assert.match(packageScripts["test-all"], /run-with-timeout\.mjs aggregate/);
  assert.doesNotMatch(
    packageScripts["test-all"],
    /--owns-e2e-ports/,
    "test-all does not run Playwright and must not sweep E2E ports",
  );
  assert.match(heavySource, /wrapWithLocks/);
  assert.match(heavySource, /"unit-cpu", "e2e-port"/);
  assert.match(heavySource, /include-own-tree/);
});

test("aggregate budget covers the serialized heavy-stage allowances", () => {
  const required =
    budgets.tierStandard.runBudgetMs +
    budgets.rootUnit.runBudgetMs +
    budgets.e2e.runBudgetMs * 2;
  assert.ok(
    budgets.aggregate.totalBudgetMs >= required,
    `aggregate budget must cover preflight + unit + palette + full e2e (${required}ms)`,
  );
});

test("database Vitest project registers its configured file-budget guard", () => {
  const config = read("lib/db/vitest.config.ts");
  const setup = read("lib/db/src/__tests__/setup.ts");
  assert.match(config, /setupFiles:\s*\["\.\/src\/__tests__\/setup\.ts"\]/);
  assert.match(setup, /installFileBudgetGuard\("libDbUnit"\)/);
  assert.equal(budgets.libDbUnit.fileBudgetMs, 60000);
});

test("tier steps use the canonical registry and named conflict resources", () => {
  const steps = getValidationSteps("port-authority-test");
  assert.ok(steps.length > 0);
  assert.equal(steps.find(({ name }) => name === "typecheck").resource, "codegen");
  assert.equal(steps.find(({ name }) => name === "test:unit").resource, "unit-cpu");
  assert.deepEqual(
    steps.find(({ name }) => name === "check:ports").tiers,
    ["full"],
  );
  for (const step of steps) {
    assert.ok(Array.isArray(step.tiers) && step.tiers.length > 0, step.name);
  }
});

test("E2E startup and relocated palette ports use tests/e2e/ports.ts", () => {
  const ports = read("tests/e2e/ports.ts");
  const config = read("playwright.config.ts");
  const heavy = read("scripts/test-heavy-serial.mjs");
  const globalSetup = read("tests/e2e/global-setup.ts");
  const viteConfig = read("artifacts/bathyscan/vite.config.ts");

  assert.match(ports, /E2E_PALETTE_WEB_PORT/);
  assert.match(ports, /E2E_PALETTE_API_PORT/);
  assert.match(heavy, /tests\/e2e\/ports\.ts/);
  assert.match(heavy, /E2E_PALETTE_WEB_PORT/);
  assert.match(heavy, /E2E_PALETTE_API_PORT/);
  assert.doesNotMatch(heavy, /E2E_WEB_PORT=3[0-9]{3} E2E_API_PORT=3[0-9]{3}/);

  const sweep = config.indexOf("PW_E2E_PORT_SWEEP_DONE");
  const webServerConfig = config.indexOf("webServer:");
  assert.ok(sweep >= 0 && sweep < webServerConfig, "stale sweep must run before webServer probing");
  assert.match(config, /kill-port-holders\.mjs/);
  assert.doesNotMatch(globalSetup, /kill-port-holders\.mjs/);
  assert.match(viteConfig, /kill-port-holders\.mjs/);
  assert.doesNotMatch(viteConfig, /\blsof\b|\bfuser\b/);
});

test("cleanup contract is guarded against unsafe invocation", () => {
  const cleanup = read("scripts/kill-port-holders.mjs");
  assert.match(cleanup, /KILL_PORT_HOLDERS_RUNNING/);
  assert.match(cleanup, /NODE_ENV === "production"/);
  assert.match(cleanup, /REPLIT_DEPLOYMENT === "1"/);
  assert.match(cleanup, /unknownFlags/);
  assert.match(cleanup, /SIGTERM/);
  assert.match(cleanup, /SIGKILL/);
  assert.match(cleanup, /waitPortFree/);
  assert.match(cleanup, /\/proc\/net\/tcp6/);
});