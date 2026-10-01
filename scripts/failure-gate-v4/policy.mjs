import { readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { VALIDATION_COMMANDS } from "../register-validation-commands.mjs";
import { getStepsForTier, getValidationSteps } from "../validation-steps.mjs";
import { canonicalJson, digestJson, sha256 } from "./canonical.mjs";

const TIER_ARGUMENT = Object.freeze({
  "test-fast": "fast",
  "test-standard": "standard",
  "test-standard-plus": "full",
  "test-heavy": "full",
});

// These are the actual entry points and shared policy inputs used by the
// existing command definitions. A change to any input changes the approved
// definition digest rather than silently inheriting an old authorization.
export const TIER_POLICY_FILES = Object.freeze([
  ".gitignore",
  ".npmrc",
  "pnpm-workspace.yaml",
  "package.json",
  "scripts/package.json",
  "pnpm-lock.yaml",
  "playwright.config.ts",
  "scripts/register-validation-commands.mjs",
  "scripts/validation-steps.mjs",
  "scripts/codegen-freshness.mjs",
  "scripts/run-tier.mjs",
  "scripts/lib/step-report.mjs",
  "scripts/run-locked-tier.mjs",
  "scripts/lib/tier-lock-check.mjs",
  "scripts/lib/task-validation-launch.mjs",
  "scripts/check-failure-gate.mjs",
  "scripts/check-regression-guard.mjs",
  "scripts/run-with-timeout.mjs",
  "scripts/validation-lock.mjs",
  "scripts/clean-stale-validation-locks.mjs",
  "scripts/test-heavy-serial.mjs",
  "scripts/lib/tier-lock-check.mjs",
  "scripts/lib/check-test-dependencies.mjs",
  "lib/api-spec/scripts/validate-openapi.mjs",
  "tests/timeout-guard/budgets.json",
  "tests/e2e/ports.ts",
  "docs/validation/failure-baseline.json",
  "artifacts/api-server/vitest.config.ts",
  "artifacts/api-server/vitest.config.validation.ts",
  "artifacts/bathyscan/vite.config.ts",
  "artifacts/bathyscan/vitest.config.ts",
  "artifacts/bathyscan/vitest.config.validation.ts",
  "artifacts/mockup-sandbox/vite.config.ts",
  "lib/api-zod/vitest.config.ts",
  "lib/db/vitest.config.ts",
  "lib/poe/vitest.config.ts",
  "scripts/failure-gate-v4/canonical.mjs",
  "scripts/failure-gate-v4/engine-evidence.mjs",
  "scripts/failure-gate-v4/assessment.mjs",
  "scripts/failure-gate-v4/classification.mjs",
  "scripts/failure-gate-v4/stored-classification.mjs",
  "scripts/failure-gate-v4/planning.mjs",
  "scripts/failure-gate-v4/coordinator.mjs",
  "scripts/failure-gate-v4/run-context.mjs",
  "scripts/failure-gate-v4/git-review.mjs",
  "scripts/failure-gate-v4/policy.mjs",
  "scripts/failure-gate-v4/runner.mjs",
  "scripts/failure-gate-v4/agent-task-bridge.mjs",
  "scripts/failure-gate-v4/bootstrap-policy.mjs",
  "scripts/failure-gate-v4/diagnostics.mjs",
  "scripts/failure-gate-v4/suite-coverage.mjs",
  "scripts/failure-gate-v4/recovery.mjs",
  "scripts/failure-gate-v4/replit-task.mjs",
  "scripts/failure-gate-v4/snapshot.mjs",
  "scripts/failure-gate-v4/store.mjs",
  "scripts/failure-gate-v4/writer-lock.mjs",
  "scripts/failure-gate-v4/node-tap-report.mjs",
  "scripts/failure-gate-v4/node-test-reporter.mjs",
  "scripts/failure-gate-v4/playwright-reporter.mjs",
  "scripts/failure-gate-v4/run-node-test-suite.mjs",
  "scripts/failure-gate-v4/run-writer.mjs",
  "scripts/failure-gate-v4/test-case-report.mjs",
  "scripts/failure-gate-v4/vitest-reporter.mjs",
  "scripts/failure-gate-v4/writer-routes.mjs",
]);

const STEP_REPORT_ADAPTERS = Object.freeze({
  "test-fast": "run-tier-report-v2",
  "test-standard": "run-tier-report-v2",
  "test-standard-plus": "run-tier-report-v2",
  "test-heavy": "test-heavy-report-v2",
});

function rootFile(root, path) {
  const candidate = resolve(root, path);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new Error(`policy input escapes the project root: ${path}`);
  }
  return candidate;
}

function safePolicyFileDigestForRoot(root, relativePath) {
  const content = readFileSync(rootFile(root, relativePath));
  if (relativePath === ".npmrc") {
    const safeLines = content.toString("utf8").split(/\r?\n/).map((line) => {
      const separator = line.indexOf("=");
      if (separator < 0 || !/(?:auth|token|password|username)/i.test(line.slice(0, separator))) return line;
      return `${line.slice(0, separator)}=<redacted>`;
    });
    return sha256(safeLines.join("\n"));
  }
  return sha256(content);
}

export function getRegisteredTierPolicy(projectRoot, tierName) {
  const root = realpathSync(resolve(projectRoot));
  const command = VALIDATION_COMMANDS.find((entry) =>
    entry.name === tierName && entry.budgetKey !== null,
  );
  if (!command) throw new Error(`unknown or non-tier validation command '${tierName}'`);
  const runTierArgument = TIER_ARGUMENT[tierName];
  if (!runTierArgument) throw new Error(`no checked runner mapping exists for '${tierName}'`);

  const allSteps = getValidationSteps("failure-gate-v4");
  const selectedSteps = getStepsForTier(allSteps, runTierArgument);
  const stepDefinitions = allSteps.map((step) => ({
    name: step.name,
    resource: step.resource,
    command: typeof step.cmd === "function" ? step.cmd.toString() : step.cmd,
    tiers: step.tiers,
  }));
  const fileDigests = Object.fromEntries(TIER_POLICY_FILES.map((relativePath) => [
    relativePath,
    safePolicyFileDigestForRoot(root, relativePath),
  ]));
  const loadedCodeFiles = {
    "scripts/register-validation-commands.mjs": new URL("../register-validation-commands.mjs", import.meta.url),
    "scripts/validation-steps.mjs": new URL("../validation-steps.mjs", import.meta.url),
    "scripts/failure-gate-v4/canonical.mjs": new URL("./canonical.mjs", import.meta.url),
    "scripts/failure-gate-v4/assessment.mjs": new URL("./assessment.mjs", import.meta.url),
    "scripts/failure-gate-v4/coordinator.mjs": new URL("./coordinator.mjs", import.meta.url),
    "scripts/failure-gate-v4/git-review.mjs": new URL("./git-review.mjs", import.meta.url),
    "scripts/failure-gate-v4/policy.mjs": new URL("./policy.mjs", import.meta.url),
    "scripts/failure-gate-v4/runner.mjs": new URL("./runner.mjs", import.meta.url),
    "scripts/failure-gate-v4/suite-coverage.mjs": new URL("./suite-coverage.mjs", import.meta.url),
    "scripts/failure-gate-v4/agent-task-bridge.mjs": new URL("./agent-task-bridge.mjs", import.meta.url),
    "scripts/failure-gate-v4/replit-task.mjs": new URL("./replit-task.mjs", import.meta.url),
    "scripts/failure-gate-v4/bootstrap-policy.mjs": new URL("./bootstrap-policy.mjs", import.meta.url),
    "scripts/failure-gate-v4/diagnostics.mjs": new URL("./diagnostics.mjs", import.meta.url),
    "scripts/failure-gate-v4/recovery.mjs": new URL("./recovery.mjs", import.meta.url),
    "scripts/failure-gate-v4/snapshot.mjs": new URL("./snapshot.mjs", import.meta.url),
    "scripts/failure-gate-v4/store.mjs": new URL("./store.mjs", import.meta.url),
    "scripts/failure-gate-v4/writer-lock.mjs": new URL("./writer-lock.mjs", import.meta.url),
  };
  for (const [relativePath, loadedUrl] of Object.entries(loadedCodeFiles)) {
    if (sha256(readFileSync(loadedUrl)) !== fileDigests[relativePath]) {
      throw new Error(`loaded validation policy code differs from project-root file '${relativePath}'`);
    }
  }
  const registryDigest = digestJson({
    commands: VALIDATION_COMMANDS,
    stepDefinitions,
  });
  const wrapperDigest = digestJson(fileDigests);
  const selectedStepNames = tierName === "test-heavy"
    ? [
        "PREFLIGHT",
        ...getStepsForTier(allSteps, "standard")
          .filter((step) => step.name !== "test:unit").map((step) => step.name),
        "test:unit", "e2e-palette", "test:e2e",
      ]
    : selectedSteps.map((step) => step.name);
  const tierDefinitionDigest = digestJson({
    tierName,
    command,
    runTierArgument,
    registryDigest,
    wrapperDigest,
    selectedStepNames,
    reportAdapterId: STEP_REPORT_ADAPTERS[tierName] ?? null,
  });

  return Object.freeze({
    tierName,
    command: Object.freeze({ ...command }),
    runTierArgument,
    registryDigest,
    wrapperDigest,
    tierDefinitionDigest,
    selectedStepNames: Object.freeze(selectedStepNames),
    reportAdapterId: STEP_REPORT_ADAPTERS[tierName] ?? null,
    policyFileDigests: Object.freeze(fileDigests),
    reportAdapterKnown: Object.hasOwn(STEP_REPORT_ADAPTERS, tierName),
  });
}

export function getRegisteredValidationPolicy(projectRoot) {
  const registeredTiers = VALIDATION_COMMANDS
    .filter((entry) => entry.budgetKey !== null)
    .map((entry) => entry.name);
  if (new Set(registeredTiers).size !== registeredTiers.length || registeredTiers.length === 0) {
    throw new Error("installed validation command registry has duplicate or missing tier names");
  }
  const tiers = Object.fromEntries(registeredTiers.map((tierName) => [
    tierName,
    getRegisteredTierPolicy(projectRoot, tierName),
  ]));
  const first = tiers[registeredTiers[0]];
  if (registeredTiers.some((tierName) =>
    tiers[tierName].registryDigest !== first.registryDigest ||
    tiers[tierName].wrapperDigest !== first.wrapperDigest,
  )) {
    throw new Error("installed tier registry produced conflicting registry or wrapper digests");
  }
  const snapshotDigest = digestJson({
    registeredTiers,
    registryDigest: first.registryDigest,
    wrapperDigest: first.wrapperDigest,
    tierDefinitionDigests: Object.fromEntries(registeredTiers.map((tierName) => [
      tierName,
      tiers[tierName].tierDefinitionDigest,
    ])),
  });
  return Object.freeze({
    registeredTiers: Object.freeze(registeredTiers),
    registryDigest: first.registryDigest,
    wrapperDigest: first.wrapperDigest,
    snapshotDigest,
    tiers: Object.freeze(tiers),
  });
}

export function getTierDefinitionDigest(projectRoot, tierName) {
  return getRegisteredTierPolicy(projectRoot, tierName).tierDefinitionDigest;
}

export function canonicalTierPolicy(policy) {
  return canonicalJson(policy);
}