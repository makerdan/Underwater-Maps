import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findUncoveredChecks,
  findStaleAllowlistEntries,
  findOrphanCheckFiles,
  findStaleOrphanAllowlistEntries,
  listCheckFiles,
  buildReferenceText,
  CI_COVERAGE_ALLOWLIST,
  ORPHAN_FILE_ALLOWLIST,
  GITHUB_CI_COVERAGE,
  findGithubCiParityProblems,
  buildGithubWorkflowText,
  extractGithubWorkflowRunText,
  extractGithubWorkflowRunCommands,
  findE2eDatabaseBootstrapProblems,
  isSupportedLocalOnlyExclusion,
  getGithubWorkflowScopes,
  readGithubWorkflowRuns,
  findRedundantStandaloneSuiteRuns,
  findSuiteOverlapExclusionProblems,
  GITHUB_SUITE_OVERLAP_EXCLUSIONS,
} from "../check-runner-step-sync.mjs";
import { getValidationSteps, getStepsForTier, KNOWN_TIERS } from "../validation-steps.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

// ---------------------------------------------------------------------------
// Shared step-list module — both runners consume the same list, so the old
// parser-based sync check is gone; assert the shared module's shape instead.
// ---------------------------------------------------------------------------

test("shared step list has valid entries and no duplicate names", () => {
  const steps = getValidationSteps("test");
  assert.ok(steps.length > 0, "expected at least one step");
  for (const s of steps) {
    assert.equal(typeof s.name, "string");
    assert.ok(s.name.length > 0);
    assert.ok(
      typeof s.cmd === "string" || typeof s.cmd === "function",
      `step ${s.name}: cmd must be a string or function`,
    );
    assert.ok(
      s.resource === null || typeof s.resource === "string",
      `step ${s.name}: resource must be null or a string`,
    );
  }
  const names = steps.map((s) => s.name);
  assert.equal(new Set(names).size, names.length, "duplicate step names in shared list");
});

// ---------------------------------------------------------------------------
// Resource-name guard — both runners wrap steps with a non-null resource in
// validation-lock.mjs. A typo'd resource name would still "work" (the lock
// wrapper creates a lock file for any name) but would silently stop
// serializing against the real resource, so pin every declared resource to
// the known set.
// ---------------------------------------------------------------------------

const KNOWN_RESOURCES = ["codegen", "unit-cpu", "e2e-port", "global"];

test("every step with a non-null resource uses a known resource name", () => {
  const steps = getValidationSteps("test");
  for (const s of steps) {
    if (s.resource === null) continue;
    assert.ok(
      KNOWN_RESOURCES.includes(s.resource),
      `step ${s.name}: resource ${JSON.stringify(s.resource)} is not a known resource name ` +
        `(${KNOWN_RESOURCES.join(", ")}) — a typo'd resource silently bypasses lock enforcement; ` +
        `if this is a genuinely new resource, add it to KNOWN_RESOURCES here deliberately`,
    );
  }
});

// ---------------------------------------------------------------------------
// Tier-tag selection — every step must declare explicit tier membership
// ---------------------------------------------------------------------------

test("every step declares a non-empty, known tiers array", () => {
  const steps = getValidationSteps("test");
  for (const s of steps) {
    assert.ok(Array.isArray(s.tiers) && s.tiers.length > 0, `step ${s.name}: missing tiers`);
    for (const t of s.tiers) {
      assert.ok(KNOWN_TIERS.includes(t), `step ${s.name}: unknown tier ${t}`);
    }
  }
});

test("getStepsForTier throws on a step with no tier assignment", () => {
  const steps = [{ name: "ok", tiers: ["fast"] }, { name: "untagged" }];
  assert.throws(() => getStepsForTier(steps, "fast"), /untagged.*no tier assignment/s);
});

test("getStepsForTier throws on empty tiers array and unknown tier tag", () => {
  assert.throws(
    () => getStepsForTier([{ name: "empty", tiers: [] }], "fast"),
    /no tier assignment/,
  );
  assert.throws(
    () => getStepsForTier([{ name: "bad", tiers: ["turbo"] }], "fast"),
    /unknown tier tag/,
  );
  assert.throws(() => getStepsForTier([], "nope"), /unknown tier/);
});

test("getStepsForTier selects by tag preserving list order", () => {
  const steps = [
    { name: "a", tiers: ["fast", "standard", "full"] },
    { name: "b", tiers: ["standard", "full"] },
    { name: "c", tiers: ["full"] },
  ];
  assert.deepEqual(getStepsForTier(steps, "fast").map((s) => s.name), ["a"]);
  assert.deepEqual(getStepsForTier(steps, "standard").map((s) => s.name), ["a", "b"]);
  assert.deepEqual(getStepsForTier(steps, "full").map((s) => s.name), ["a", "b", "c"]);
});

test("tier structure obeys the fast⊂standard⊂full cumulative convention", () => {
  const steps = getValidationSteps("test");

  const fastNames = new Set(getStepsForTier(steps, "fast").map((s) => s.name));
  const standardNames = new Set(getStepsForTier(steps, "standard").map((s) => s.name));
  const fullNames = new Set(getStepsForTier(steps, "full").map((s) => s.name));

  // full tier must contain every step — no step may be invisible at the highest tier
  assert.deepEqual(
    getStepsForTier(steps, "full").map((s) => s.name),
    steps.map((s) => s.name),
    "full tier must contain every step",
  );

  // fast ⊆ standard: any step tagged "fast" must also be tagged "standard"
  for (const name of fastNames) {
    assert.ok(
      standardNames.has(name),
      `step "${name}" is in fast tier but not standard tier — ` +
        `fast-tier steps must also be tagged "standard" (and "full")`,
    );
  }

  // standard ⊆ full: any step tagged "standard" must also be tagged "full"
  for (const name of standardNames) {
    assert.ok(
      fullNames.has(name),
      `step "${name}" is in standard tier but not full tier — ` +
        `standard-tier steps must also be tagged "full"`,
    );
  }
});

// ---------------------------------------------------------------------------
// CI coverage meta-check
// ---------------------------------------------------------------------------

test("check:* script missing from both CI sequence and allowlist is flagged", () => {
  const pkg = { scripts: { "check:foo": "x", "check:orphan": "y", lint: "z" } };
  const uncovered = findUncoveredChecks(pkg, ["typecheck", "lint", "check:foo"], {});
  assert.deepEqual(uncovered, ["check:orphan"]);
});

test("allowlisted check:* script is not flagged", () => {
  const pkg = { scripts: { "check:orphan": "y" } };
  const uncovered = findUncoveredChecks(pkg, [], { "check:orphan": "covered elsewhere" });
  assert.deepEqual(uncovered, []);
});

test("stale allowlist entries are flagged (removed script or now in CI)", () => {
  const pkg = { scripts: { "check:foo": "x" } };
  const stale = findStaleAllowlistEntries(pkg, ["check:foo"], {
    "check:foo": "now redundant — runs in CI",
    "check:gone": "script no longer exists",
  });
  assert.deepEqual(stale.sort(), ["check:foo", "check:gone"]);
});

// ---------------------------------------------------------------------------
// GitHub Actions parity contract
// ---------------------------------------------------------------------------

test("GitHub parity flags a canonical step with no coverage declaration", () => {
  const problems = findGithubCiParityProblems([{ name: "check:new-guard" }], "", {});
  assert.deepEqual(problems, ["check:new-guard: no GitHub CI coverage entry"]);
});

test("GitHub parity flags a missing workflow token and invalid exclusion contract", () => {
  const missingToken = findGithubCiParityProblems(
    [{ name: "check:portable", cmd: "pnpm run check:portable" }],
    "pnpm run something-else",
    { "check:portable": { tokens: ["pnpm run check:portable"] } },
  );
  assert.deepEqual(
    missingToken,
    ['check:portable: GitHub workflow token missing: "pnpm run check:portable"'],
  );

  const invalidContract = findGithubCiParityProblems(
    [{ name: "check:bad" }],
    "",
    { "check:bad": { tokens: ["pnpm run check:bad"], excluded: "This would make the coverage contract ambiguous." } },
  );
  assert.deepEqual(
    invalidContract,
    ["check:bad: declare exactly one of non-empty tokens or a substantive excluded reason"],
  );
});

test("GitHub parity binds tokens to the canonical command or a documented equivalent", () => {
  const unrelated = findGithubCiParityProblems(
    [{ name: "check:new", cmd: "pnpm run check:new" }],
    "pnpm run lint",
    { "check:new": { tokens: ["pnpm run lint"] } },
  );
  assert.deepEqual(
    unrelated,
    ["check:new: workflow tokens must include the canonical command or use a mechanically verified composite/suite equivalent"],
  );

  const equivalent = findGithubCiParityProblems(
    [{ name: "check:new", cmd: "pnpm run check:new" }],
    "pnpm run verify",
    {
      "check:new": {
        tokens: ["pnpm run verify"],
        compositeScript: "verify",
      },
    },
    {
      verify: "pnpm run lint && pnpm run check:new",
    },
  );
  assert.deepEqual(equivalent, []);

  const lyingEquivalent = findGithubCiParityProblems(
    [{ name: "check:new", cmd: "pnpm run check:new" }],
    "pnpm run verify",
    {
      "check:new": {
        tokens: ["pnpm run verify"],
        compositeScript: "verify",
      },
    },
    {
      verify: "pnpm run lint",
    },
  );
  assert.deepEqual(
    lyingEquivalent,
    ["check:new: workflow tokens must include the canonical command or use a mechanically verified composite/suite equivalent"],
  );
});

test("GitHub parity only accepts executable command positions, not comments or echo arguments", () => {
  const coverage = { "check:portable": { tokens: ["pnpm run check:portable"] } };
  assert.deepEqual(
    findGithubCiParityProblems(
      [{ name: "check:portable", cmd: "pnpm run check:portable" }],
      "echo ok # pnpm run check:portable\necho 'pnpm run check:portable'",
      coverage,
    ),
    ['check:portable: GitHub workflow token missing: "pnpm run check:portable"'],
  );
  assert.deepEqual(
    findGithubCiParityProblems(
      [{ name: "check:portable", cmd: "pnpm run check:portable" }],
      "CI=true pnpm run check:portable --flag",
      coverage,
    ),
    [],
  );
});

test("GitHub parity flags stale declarations and accepts documented local-only exclusions", () => {
  const problems = findGithubCiParityProblems(
    [{ name: "check:local-only" }],
    "",
    {
      "check:local-only": {
        excluded: "Requires Agent-local state that GitHub Actions cannot reproduce safely.",
        dependency: "replit-state",
        canonicalCommand: "pnpm run check:local-only",
      },
      "check:removed": { excluded: "This old entry no longer corresponds to a canonical validation step." },
    },
  );
  assert.deepEqual(problems, ["check:removed: stale GitHub CI coverage entry"]);
});

test("GitHub parity requires local-only exclusions to name a supported environment dependency", () => {
  assert.equal(
    isSupportedLocalOnlyExclusion({
      excluded: "Requires Replit state that is unavailable in GitHub Actions.",
    }),
    false,
  );
  assert.equal(
    isSupportedLocalOnlyExclusion({
      excluded: "Requires Agent task-plan context in gitignored .local/tasks data.",
      dependency: "task-plan-context",
    }),
    true,
  );

  const problems = findGithubCiParityProblems(
    [{ name: "check:local-only" }],
    "",
    {
      "check:local-only": {
        excluded: "This is intentionally local only and has enough words.",
        dependency: "not-a-supported-category",
      },
    },
  );
  assert.match(problems[0], /supported dependency category/);
});

test("GitHub parity flags an exclusion that becomes unnecessary when its command reaches PR CI", () => {
  const problems = findGithubCiParityProblems(
    [{ name: "check:local-only", cmd: "pnpm run check:local-only" }],
    "pnpm run check:local-only",
    {
      "check:local-only": {
        excluded: "Requires Replit validation-lock state that GitHub normally lacks.",
        dependency: "replit-state",
      },
    },
  );
  assert.deepEqual(
    problems,
    ["check:local-only: stale local-only exclusion — its canonical command now runs in a pull-request workflow"],
  );
});

test("GitHub workflow extraction counts run commands but not comments or step names", () => {
  const runText = extractGithubWorkflowRunText(`
    # pnpm run check:comment-only
    - name: pnpm run check:name-only
      run: pnpm run check:scalar
    - name: Folded command
      run: >-
        pnpm run check:block
        --flag
        # pnpm run check:block-comment
    - name: Inline comment
      run: echo ok # pnpm run check:inline-comment
    - name: Quoted hash
      run: echo "keep # as data"
  `);
  assert.match(runText, /pnpm run check:scalar/);
  assert.match(runText, /pnpm run check:block/);
  assert.doesNotMatch(runText, /comment-only/);
  assert.doesNotMatch(runText, /name-only/);
  assert.doesNotMatch(runText, /block-comment/);
  assert.doesNotMatch(runText, /inline-comment/);
  assert.match(runText, /keep # as data/);
});

test("GitHub workflow text includes PR run commands and ignores main-only workflows", () => {
  const workflowText = buildGithubWorkflowText(root);
  assert.match(workflowText, /pnpm run check:runner-step-sync/);
  assert.match(workflowText, /pnpm run check:fixture-freshness/);
  assert.doesNotMatch(workflowText, /DIST_DIR=dist-e2e-\$\{E2E_API_PORT\}/);
});

test("fresh-database E2E workflows use schema push instead of migrations", () => {
  const pushWorkflow = `
    # pnpm --filter @workspace/db run migrate
    - name: Create database schema
      run: pnpm --filter @workspace/db run push-force
  `;
  const migrateWorkflow = `
    - name: Run database migrations
      run: pnpm --filter @workspace/db run migrate
  `;

  assert.deepEqual(
    findE2eDatabaseBootstrapProblems(pushWorkflow, pushWorkflow),
    [],
  );
  assert.deepEqual(
    findE2eDatabaseBootstrapProblems(migrateWorkflow, pushWorkflow),
    [
      "ci-e2e-pr.yml: fresh database bootstrap must run push-force",
      "ci-e2e-pr.yml: fresh database bootstrap must not run migrate",
    ],
  );
});

test("workflow scopes separate pull-request and push commands", () => {
  assert.deepEqual(
    getGithubWorkflowScopes("on:\n  pull_request:\n  push:\n    branches: [main]\n"),
    ["pull-request", "push"],
  );
  assert.deepEqual(
    getGithubWorkflowScopes("on: [push, pull_request]\n"),
    ["pull-request", "push"],
  );
  assert.deepEqual(
    getGithubWorkflowScopes('"on": pull_request_target\n'),
    ["pull-request"],
  );
  assert.deepEqual(
    getGithubWorkflowScopes("on:\n  workflow_dispatch: # pull_request\n"),
    [],
  );
  assert.deepEqual(getGithubWorkflowScopes("on:\n  workflow_dispatch:\n"), []);
});

test("workflow reader returns only executable run commands", () => {
  const workflows = readGithubWorkflowRuns(root);
  const prWorkflow = workflows.find((workflow) => workflow.file === "ci-pr.yml");
  assert.ok(prWorkflow);
  assert.ok(prWorkflow.scopes.includes("pull-request"));
  assert.ok(prWorkflow.commands.includes("pnpm run check:runner-step-sync"));
  assert.ok(!prWorkflow.commands.some((command) => command.includes("Static checks + unit suites")));
});

// ---------------------------------------------------------------------------
// Behavioral suite routing — targeted runs may not duplicate discovery
// ---------------------------------------------------------------------------

test("duplicate targeted unit and browser runs are flagged within the same event scope", () => {
  const problems = findRedundantStandaloneSuiteRuns([
    {
      file: "ci.yml",
      scopes: ["pull-request"],
      commands: [
        "pnpm exec vitest run --shard=1/2",
        "pnpm exec vitest run artifacts/api-server/src/foo.test.ts",
        "pnpm --filter @workspace/api-server run test:unit -- src/bar.test.ts",
        "pnpm exec vitest run --grep focused-case",
        "pnpm exec vitest run --project api-server",
        "pnpm exec playwright test",
        'npx playwright test "tests/e2e/foo.spec.ts"',
        "pnpm exec playwright test --grep focused-case",
      ],
    },
  ], []);
  assert.deepEqual(
    problems.map((problem) => `${problem.suite}:${problem.command}`),
    [
      "unit:pnpm exec vitest run artifacts/api-server/src/foo.test.ts",
      "unit:pnpm --filter @workspace/api-server run test:unit -- src/bar.test.ts",
      "unit:pnpm exec vitest run --grep focused-case",
      "unit:pnpm exec vitest run --project api-server",
      'browser:npx playwright test "tests/e2e/foo.spec.ts"',
      "browser:pnpm exec playwright test --grep focused-case",
    ],
  );
});

test("browser suite detection normalizes pnpm exec, quotes, and continuations", () => {
  const workflows = [{
    file: "ci.yml",
    scopes: ["pull-request"],
    commands: [
      "pnpm exec playwright test",
      "pnpm exec playwright test \\\n        \"tests/e2e/smoke.spec.ts\"",
    ],
  }];
  const problems = findRedundantStandaloneSuiteRuns(workflows, []);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].suite, "browser");
});

test("workflow comment lines containing Playwright are not executable commands", () => {
  const commands = extractGithubWorkflowRunCommands(`
    # playwright test tests/e2e/comment.spec.ts
    - name: Comment only
      run: echo "# playwright test"
  `);
  assert.deepEqual(commands, ['echo "# playwright test"']);
  assert.deepEqual(
    findRedundantStandaloneSuiteRuns([{
      file: "ci.yml",
      scopes: ["pull-request"],
      commands,
    }], []),
    [],
  );
});

test("real E2E workflows preserve the fresh-database bootstrap contract", () => {
  const workflowsDir = resolve(root, ".github", "workflows");
  const prWorkflow = readFileSync(
    resolve(workflowsDir, "ci-e2e-pr.yml"),
    "utf8",
  );
  const mainWorkflow = readFileSync(
    resolve(workflowsDir, "ci-e2e.yml"),
    "utf8",
  );

  assert.deepEqual(
    findE2eDatabaseBootstrapProblems(prWorkflow, mainWorkflow),
    [],
  );
});

test("targeted suites on a different event scope do not count as duplicates", () => {
  const problems = findRedundantStandaloneSuiteRuns([
    { file: "main.yml", scopes: ["push"], commands: ["pnpm exec playwright test"] },
    {
      file: "pr.yml",
      scopes: ["pull-request"],
      commands: ["pnpm exec playwright test tests/e2e/smoke.spec.ts"],
    },
  ], []);
  assert.deepEqual(problems, []);
});

test("a recorded overlap is accepted and stale or malformed declarations are flagged", () => {
  const workflows = [{
    file: "ci-e2e.yml",
    scopes: ["push"],
    commands: [
      "pnpm exec playwright test",
      "pnpm exec playwright test tests/e2e/palette-cross-device-sync.spec.ts",
    ],
  }];
  const exclusion = [{
    workflow: "ci-e2e.yml",
    scope: "push",
    command: "pnpm exec playwright test tests/e2e/palette-cross-device-sync.spec.ts",
    reason: "Uses dedicated ports and test identity to preserve sync-isolation coverage.",
  }];

  assert.deepEqual(findRedundantStandaloneSuiteRuns(workflows, exclusion), []);
  assert.deepEqual(findSuiteOverlapExclusionProblems(workflows, exclusion), []);
  assert.deepEqual(
    findSuiteOverlapExclusionProblems(workflows, [{
      workflow: "ci-e2e.yml",
      scope: "push",
      command: "pnpm exec playwright test tests/e2e/removed.spec.ts",
      reason: "This recorded command no longer exists in the real workflow.",
    }]),
    ["ci-e2e.yml (push): stale suite-overlap exclusion for exact command"],
  );
  assert.deepEqual(
    findSuiteOverlapExclusionProblems(workflows, [{
      workflow: "ci-e2e.yml",
      scope: "push",
      command: "x",
      reason: "short",
    }]),
    ["malformed suite-overlap exclusion (workflow, scope, exact command, and substantive reason are required)"],
  );
});

// ---------------------------------------------------------------------------
// Orphaned check-file audit
// ---------------------------------------------------------------------------

test("a check file referenced nowhere is flagged as an orphan", () => {
  const files = ["check-used.sh", "check-orphan.sh"];
  const refText = 'scripts": "bash scripts/check-used.sh"';
  assert.deepEqual(findOrphanCheckFiles(files, refText, {}), ["check-orphan.sh"]);
});

test("an allowlisted orphan check file is not flagged", () => {
  const orphans = findOrphanCheckFiles(["check-manual.mjs"], "", {
    "check-manual.mjs": "manual-only tooling",
  });
  assert.deepEqual(orphans, []);
});

test("GitHub workflow references count as non-orphaned check-file references", () => {
  const refText = buildReferenceText(root, resolve(root, "scripts"));
  assert.match(refText, /check:runner-step-sync/);
  assert.deepEqual(findOrphanCheckFiles(["check-runner-step-sync.mjs"], refText, {}), []);
});

test("stale orphan allowlist entries are flagged (deleted file or now referenced)", () => {
  const stale = findStaleOrphanAllowlistEntries(
    ["check-now-used.sh"],
    "node scripts/check-now-used.sh",
    { "check-now-used.sh": "was manual", "check-deleted.mjs": "gone" },
  );
  assert.deepEqual(stale.sort(), ["check-deleted.mjs", "check-now-used.sh"]);
});

// ---------------------------------------------------------------------------
// Real-tree assertions — the actual repo files must currently pass
// ---------------------------------------------------------------------------

test("all check:* scripts in package.json are covered by the shared step list or allowlist", () => {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const ciSteps = getValidationSteps("test").map((s) => s.name);

  assert.deepEqual(findUncoveredChecks(pkg, ciSteps), []);
  assert.deepEqual(findStaleAllowlistEntries(pkg, ciSteps), []);
  assert.ok(Object.values(CI_COVERAGE_ALLOWLIST).every((r) => typeof r === "string" && r.length > 10));
});

test("every canonical validation step has portable GitHub coverage or a documented local-only exclusion", () => {
  const workflowText = buildGithubWorkflowText(root);
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assert.ok(workflowText.length > 0, "expected GitHub PR workflow run commands");
  assert.deepEqual(
    findGithubCiParityProblems(getValidationSteps("test"), workflowText, GITHUB_CI_COVERAGE, pkg.scripts),
    [],
  );
  assert.ok(
    Object.values(GITHUB_CI_COVERAGE).every((entry) =>
      (Array.isArray(entry.tokens) && entry.tokens.length > 0) ||
      (typeof entry.excluded === "string" &&
        entry.excluded.length >= 20 &&
        typeof entry.dependency === "string")),
  );
});

test("the committed workflows have no unrecorded duplicate behavioral suite runs or stale overlap exclusions", () => {
  const workflowRuns = readGithubWorkflowRuns(root);
  assert.ok(workflowRuns.length > 0, "expected GitHub workflows");
  assert.deepEqual(findRedundantStandaloneSuiteRuns(workflowRuns), []);
  assert.deepEqual(findSuiteOverlapExclusionProblems(workflowRuns), []);
  assert.ok(
    GITHUB_SUITE_OVERLAP_EXCLUSIONS.every(
      (entry) => typeof entry.reason === "string" && entry.reason.length >= 20,
    ),
  );
});

test("all check-* files on disk are referenced somewhere or allowlisted", () => {
  const scriptsDir = resolve(root, "scripts");
  const checkFiles = listCheckFiles(scriptsDir);
  assert.ok(checkFiles.length > 0, "expected check-* files in scripts/");
  const refText = buildReferenceText(root, scriptsDir);

  assert.deepEqual(findOrphanCheckFiles(checkFiles, refText), []);
  assert.deepEqual(findStaleOrphanAllowlistEntries(checkFiles, refText), []);
  assert.ok(Object.values(ORPHAN_FILE_ALLOWLIST).every((r) => typeof r === "string" && r.length > 10));
});

test("unreadable reference files produce a named diagnostic and continue", () => {
  const diagnostics = [];
  const text = buildReferenceText(
    resolve(root, "missing-test-root"),
    resolve(root, "scripts"),
    (filePath, error) => diagnostics.push({ filePath, error }),
  );
  assert.equal(typeof text, "string");
  assert.ok(diagnostics.some(({ filePath }) => filePath.endsWith("missing-test-root/package.json")));
  assert.ok(diagnostics.every(({ error }) => error instanceof Error));
});
