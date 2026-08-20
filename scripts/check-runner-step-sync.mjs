#!/usr/bin/env node
/**
 * check-runner-step-sync.mjs — CI coverage meta-check for the validation runners.
 *
 * The step lists for scripts/run-tier.mjs and scripts/test-all-steps.mjs are
 * now a single shared module (scripts/validation-steps.mjs), so step-list
 * drift between the runners is structurally impossible and no longer checked.
 *
 * What remains is the CI coverage meta-check:
 *   1. Every "check:*" script defined in the root package.json must appear in
 *      the shared validation-step sequence, unless it is explicitly allowlisted
 *      below with a reason. This catches check scripts that exist but silently
 *      never run in a tier, and allowlist entries that have gone stale.
 *   2. Every canonical validation step must declare its GitHub Actions coverage:
 *      either a command token found in a PR workflow, or an explicit documented
 *      local-only exclusion tied to a supported environment dependency. This
 *      prevents a new portable guard from becoming Agent-only merely because it
 *      was added to validation-steps.mjs.
 *   3. Every check-*.{mjs,sh} FILE in scripts/ must be referenced somewhere —
 *      a package.json script, a workflow (.replit), or another (non-check)
 *      script such as post-merge.sh — unless allowlisted with a reason. This
 *      catches check files that exist only on disk and can go permanently
 *      unused with no warning.
 *   4. Fresh-database E2E workflows must bootstrap from the Drizzle schema
 *      instead of the migration journal, which cannot initialize an empty DB.
 *   5. Targeted unit and browser test runs may not duplicate a discovery-based
 *      suite on the same GitHub event scope, unless the intentional overlap is
 *      recorded below with a substantive reason.
 *
 * Usage:
 *   node scripts/check-runner-step-sync.mjs
 *
 * Exported functions are unit-tested in scripts/src/check-runner-step-sync.test.mjs.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getValidationSteps } from "./validation-steps.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// CI coverage allowlist
//
// check:* scripts that intentionally do NOT appear in the shared step list.
// Every entry MUST carry a reason explaining where its coverage comes from.
// ---------------------------------------------------------------------------

export const CI_COVERAGE_ALLOWLIST = {
  "check:codegen":
    "Delegates to the api-spec package's own check; codegen freshness is enforced in CI by the typecheck step's codegen pre-pass (codegen-freshness.mjs).",
  "check:codegen-stale":
    "Runs a full codegen regeneration (slow); the typecheck step's freshness-aware pre-pass regenerates when stale, and check:drift covers this locally.",
  "check:routes-documented":
    "A vitest test file inside the api-server unit suite; already runs in CI as part of the test:unit step.",
  "check:mock-drift":
    "Vitest sentinel test files inside the bathyscan and api-server unit suites; already run in CI as part of the test:unit step.",
  "check:drift":
    "Umbrella convenience runner that re-invokes individual drift checks already present in the step sequence; running it in CI would duplicate work.",
};

// ---------------------------------------------------------------------------
// Orphaned check-file allowlist
//
// check-*.{mjs,sh} files in scripts/ that are intentionally NOT referenced by
// any package.json script, workflow, or other script (e.g. manual-only
// tooling). Keys are bare filenames; every entry MUST carry a reason.
// ---------------------------------------------------------------------------

// Intentionally empty: no check-* files currently need a permanent exemption.
// Add an entry here (with a reason string) when a file must be kept on disk
// but is not referenced by any npm script, workflow, or other script —
// e.g. { "check-manual-only.mjs": "invoked by humans, not automated runners" }.
export const ORPHAN_FILE_ALLOWLIST = {};

// ---------------------------------------------------------------------------
// GitHub Actions validation parity
//
// Every canonical validation step has exactly one entry here. `tokens` are
// searched across all .github/workflows/*.yml files that run for pull requests;
// they intentionally support equivalent coverage such as `verify`, manually
// sharded unit commands, and the dedicated drift workflow. `excluded` entries
// must explain why the check is meaningful only with Replit/Agent-local state.
// ---------------------------------------------------------------------------

/**
 * GitHub executes unit packages separately so the api-server can retain its
 * sequential two-shard OOM guard. This exact set is the only accepted
 * equivalent for the root `pnpm run test:unit` discovery command.
 */
export const WORKSPACE_UNIT_CI_TOKENS = [
  "pnpm exec vitest run --shard=1/2",
  "pnpm exec vitest run --shard=2/2",
  "pnpm --filter @workspace/api-zod run test:unit",
  "pnpm --filter @workspace/db run test:unit",
  "pnpm --filter @workspace/poe run test:unit",
  "pnpm --filter @workspace/bathyscan run test:unit",
  "pnpm --filter @workspace/scripts run test:unit",
];

export const GITHUB_CI_COVERAGE = {
  typecheck: {
    canonicalCommand: "pnpm run typecheck",
    tokens: ["pnpm run typecheck"],
  },
  lint: { tokens: ["pnpm run lint"] },
  "check:lock-skill-sync": { tokens: ["pnpm run check:lock-skill-sync"] },
  "check:skill-mirror-sync": {
    excluded: "Reads the gitignored .local/custom_skills mirror, which is Agent-local and absent from GitHub checkouts.",
    dependency: "gitignored-local-data",
  },
  "check:failure-gate-zip": { tokens: ["pnpm run check:failure-gate-zip"] },
  "check:poe-setup-zip": { tokens: ["pnpm run check:poe-setup-zip"] },
  "check:port-authority-zip": { tokens: ["pnpm run check:port-authority-zip"] },
  "check:port-authority-heavy-zip": { tokens: ["pnpm run check:port-authority-heavy-zip"] },
  "check:tier-lock": { tokens: ["pnpm run check:tier-lock"] },
  "check:root-relative-api": { tokens: ["pnpm run check:root-relative-api"] },
  "check:deps-suppression": { tokens: ["pnpm run check:deps-suppression"] },
  "check:duplicate-hooks-registry": { tokens: ["pnpm run check:duplicate-hooks-registry"] },
  "check:runner-step-sync": { tokens: ["pnpm run check:runner-step-sync"] },
  "fix:failure-gate-stubs": {
    excluded: "Mutates Agent task plans under gitignored .local/tasks/, which GitHub Actions must not create or repair.",
    dependency: "task-plan-context",
  },
  "check:failure-gate": {
    tokens: ["pnpm run verify"],
    compositeScript: "verify",
  },
  "check:failure-gate-self-test": { tokens: ["pnpm run check:failure-gate-self-test"] },
  "check:pre-commit-self-test": { tokens: ["pnpm run check:pre-commit-self-test"] },
  "check:regression-guard-self-test": { tokens: ["pnpm run check:regression-guard-self-test"] },
  "fix:regression-guard-stubs": {
    excluded: "Mutates Agent task plans under gitignored .local/tasks/, which GitHub Actions must not create or repair.",
    dependency: "task-plan-context",
  },
  "check:regression-guard": {
    tokens: ["pnpm run verify"],
    compositeScript: "verify",
  },
  "check:skip-count": { tokens: ["pnpm run check:skip-count"] },
  "check:testdb-schema-drift": { tokens: ["pnpm run check:testdb-schema-drift"] },
  "check:api-route-schema-drift": { tokens: ["pnpm run check:api-route-schema-drift"] },
  "check:runbutton-noop": { tokens: ["pnpm run check:runbutton-noop"] },
  "check:stale-lock-cleanup": {
    excluded: "Tests Replit validation-lock recovery behavior; GitHub uses isolated ephemeral runners rather than the shared local lock.",
    dependency: "replit-state",
  },
  "test:unit": {
    tokens: WORKSPACE_UNIT_CI_TOKENS,
    coverageMode: "workspace-unit-suites",
  },
  "check:docs-stale": { tokens: ["pnpm run check:docs-stale"] },
  "check:catalog-coverage": { tokens: ["pnpm run check:catalog-coverage"] },
  "check:schema-stale": { tokens: ["pnpm run check:schema-stale"] },
  "check:font-scale": { tokens: ["pnpm run check:font-scale"] },
  "check:e2e-user-ids": { tokens: ["pnpm run check:e2e-user-ids"] },
  "check:e2e-cjs-globals": { tokens: ["pnpm run check:e2e-cjs-globals"] },
  "check:e2e-panel-collapse": { tokens: ["pnpm run check:e2e-panel-collapse"] },
  "check:fixture-freshness": { tokens: ["pnpm run check:fixture-freshness"] },
  "check:ports": { tokens: ["pnpm run check:ports"] },
  "check:port-drift": { tokens: ["pnpm run check:port-drift"] },
  "check:audit": { tokens: ["pnpm run check:audit"] },
  "check:bare-pino-http-mock": { tokens: ["pnpm run check:bare-pino-http-mock"] },
  "check:trip-window-raw-units": { tokens: ["pnpm run check:trip-window-raw-units"] },
  "audit:marker-bbox": {
    excluded: "Requires a live development DATABASE_URL to audit persisted marker rows; GitHub PR runners have no production-like database state.",
    dependency: "live-development-database",
    canonicalCommand: "pnpm --filter @workspace/db audit:marker-bbox -- --ci",
  },
};

/**
 * Local-only validation can only be justified by a dependency that is absent
 * from a normal GitHub runner. Keep this intentionally narrow: "local-only"
 * alone is not a useful reviewable reason.
 */
export const LOCAL_ONLY_DEPENDENCIES = [
  "replit-state",
  "task-plan-context",
  "live-development-service",
  "live-development-database",
  "gitignored-local-data",
  "object-storage-sidecar",
];

/**
 * Existing intentional browser overlap: the relocated sync suite needs its
 * own database, ports, dist directory, and test identity. The command token
 * is executable command text, not a step name or a comment, so removing or
 * changing the suite makes this declaration stale.
 */
export const GITHUB_SUITE_OVERLAP_EXCLUSIONS = [
  {
    workflow: "ci-e2e.yml",
    scope: "push",
    command: [
      "pnpm exec playwright test",
      "--reporter=list,html,./scripts/ci-playwright-reporter.mjs",
      "tests/e2e/palette-cross-device-sync.spec.ts",
      "tests/e2e/onboarding-tour.spec.ts",
      "tests/e2e/settings-cross-device-sync.spec.ts",
      "tests/e2e/settings-save-buttons.spec.ts",
      "tests/e2e/zone-colour-server-sync.spec.ts",
      "tests/e2e/tooltips.spec.ts",
      "tests/e2e/adaptive-palette.spec.ts",
      "tests/e2e/overview-puzzle-multiselect.spec.ts",
    ].join("\n"),
    reason:
      "Uses a dedicated database, relocated ports, dist directory, and test identity to protect palette/settings synchronization isolation.",
  },
];

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * Returns check-* filenames that are referenced nowhere in the given
 * reference text (concatenated contents of package.json, .replit workflows,
 * and non-check scripts) and are not allowlisted.
 *
 * @param {string[]} checkFiles bare filenames, e.g. "check-foo.sh"
 * @param {string} referenceText concatenated searchable sources
 * @param {Record<string,string>} allowlist filename -> reason
 */
export function findOrphanCheckFiles(checkFiles, referenceText, allowlist = ORPHAN_FILE_ALLOWLIST) {
  return checkFiles.filter((f) => !referenceText.includes(f) && !(f in allowlist));
}

/**
 * Returns ORPHAN_FILE_ALLOWLIST entries that are stale: the file no longer
 * exists on disk, or it now IS referenced somewhere.
 */
export function findStaleOrphanAllowlistEntries(checkFiles, referenceText, allowlist = ORPHAN_FILE_ALLOWLIST) {
  const onDisk = new Set(checkFiles);
  return Object.keys(allowlist).filter((f) => !onDisk.has(f) || referenceText.includes(f));
}

/**
 * Enumerates check-*.{mjs,sh} files in scripts/ (bare filenames).
 */
export function listCheckFiles(scriptsDir) {
  return readdirSync(scriptsDir)
    .filter((f) => /^check-.*\.(mjs|sh)$/.test(f))
    .sort();
}

/**
 * Scans all check-*.mjs files in scriptsDir for a local `const IGNORED_DIRS`
 * re-declaration (instead of importing from scripts/lib/ignored-dirs.mjs).
 *
 * Returns an array of bare filenames that contain such a re-declaration.
 * A re-declaration is detected by the pattern /^\s*const IGNORED_DIRS\s*=/m
 * (a standalone const assignment, not an import destructuring).
 *
 * Scripts that need extra entries beyond the canonical set should use a
 * *different* local name (e.g. SKIP_DIRS) built by spreading IGNORED_DIRS:
 *   const SKIP_DIRS = new Set([...IGNORED_DIRS, "build", ...]);
 */
export function findLocalIgnoredDirsDeclarations(scriptsDir) {
  const RE = /^\s*const IGNORED_DIRS\s*=/m;
  return readdirSync(scriptsDir)
    .filter((f) => /^check-.*\.mjs$/.test(f))
    .filter((f) => {
      let src;
      try {
        src = readFileSync(resolve(scriptsDir, f), "utf8");
      } catch {
        return false;
      }
      return RE.test(src);
    });
}

/**
 * Builds the searchable reference text: root package.json, the .replit
 * workflow config, GitHub workflow sources, and every non-check *.mjs / *.sh
 * script in scripts/.
 * Check files themselves are excluded as sources so a check file cannot
 * "cover" itself (or another orphan) merely by mentioning it in a comment.
 */
export function buildReferenceText(rootDir, scriptsDir) {
  const parts = [readFileSync(resolve(rootDir, "package.json"), "utf8")];
  try {
    parts.push(readFileSync(resolve(rootDir, ".replit"), "utf8"));
  } catch {
    // .replit may not exist in stripped-down environments; skip
  }
  const workflowsDir = resolve(rootDir, ".github", "workflows");
  try {
    for (const file of readdirSync(workflowsDir)) {
      if (!/\.(yml|yaml)$/.test(file)) continue;
      parts.push(readFileSync(resolve(workflowsDir, file), "utf8"));
    }
  } catch {
    // GitHub workflows may not exist in stripped-down environments; skip
  }
  for (const f of readdirSync(scriptsDir)) {
    if (/^check-/.test(f)) continue;
    if (!/\.(mjs|sh)$/.test(f)) continue;
    parts.push(readFileSync(resolve(scriptsDir, f), "utf8"));
  }
  return parts.join("\n");
}

/**
 * Returns the names of check:* scripts in the given package.json object that
 * appear neither in the CI step sequence nor in the allowlist.
 */
export function findUncoveredChecks(pkg, ciSteps, allowlist = CI_COVERAGE_ALLOWLIST) {
  const checkNames = Object.keys(pkg.scripts ?? {}).filter((n) => n.startsWith("check:"));
  const ciSet = new Set(ciSteps);
  return checkNames.filter((n) => !ciSet.has(n) && !(n in allowlist));
}

/**
 * Returns allowlist entries that are stale: either the script no longer
 * exists in package.json, or it now DOES run in the CI sequence (so the
 * allowlist entry is redundant and should be removed).
 */
export function findStaleAllowlistEntries(pkg, ciSteps, allowlist = CI_COVERAGE_ALLOWLIST) {
  const scriptNames = new Set(Object.keys(pkg.scripts ?? {}));
  const ciSet = new Set(ciSteps);
  return Object.keys(allowlist).filter((n) => !scriptNames.has(n) || ciSet.has(n));
}

/**
 * Returns whether a local-only exclusion reason names one of the supported
 * dependencies which GitHub Actions cannot provide. The length requirement
 * rejects bare labels such as "local only"; the dependency requirement makes
 * the exception concrete and reviewable.
 */
export function isSupportedLocalOnlyExclusion(entry) {
  return typeof entry?.excluded === "string" &&
    entry.excluded.trim().length >= 20 &&
    LOCAL_ONLY_DEPENDENCIES.includes(entry?.dependency);
}

function workflowContainsExecutableToken(workflowRunText, token) {
  if (typeof token !== "string" || token.length === 0) return false;
  return workflowRunText.split("\n").some((line) =>
    line
      .split(/\s*(?:&&|\|\||;)\s*/)
      .map((segment) =>
        segment
          .trim()
          .replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)+/, ""),
      )
      .some((segment) => segment === token || segment.startsWith(`${token} `)),
  );
}

/**
 * Returns coverage-contract violations for the canonical validation registry.
 * A step needs either one or more non-empty workflow search tokens, or a
 * substantive local-only exclusion reason. Tokens must all appear in the
 * supplied workflow text so multi-command coverage (the sharded unit suite)
 * cannot silently lose a package.
 *
 * @param {Array<{name: string}>} validationSteps
 * @param {string} workflowRunText
 * @param {Record<string, {tokens?: string[], excluded?: string}>} coverage
 */
export function findGithubCiParityProblems(
  validationSteps,
  workflowRunText,
  coverage = GITHUB_CI_COVERAGE,
  packageScripts = {},
) {
  const stepNames = new Set(validationSteps.map((step) => step.name));
  const problems = [];

  for (const step of validationSteps) {
    const { name } = step;
    const entry = coverage[name];
    if (!entry) {
      problems.push(`${name}: no GitHub CI coverage entry`);
      continue;
    }
    const hasTokens = Array.isArray(entry.tokens) && entry.tokens.length > 0;
    const hasExclusion = typeof entry.excluded === "string" && entry.excluded.trim().length > 0;
    if (hasTokens === hasExclusion) {
      problems.push(`${name}: declare exactly one of non-empty tokens or a substantive excluded reason`);
      continue;
    }
    if (hasTokens) {
      const canonicalCommand =
        typeof step.cmd === "string" ? step.cmd : entry.canonicalCommand;
      if (typeof canonicalCommand !== "string" || canonicalCommand.length === 0) {
        problems.push(`${name}: function-based step must declare canonicalCommand`);
      } else if (!entry.tokens.includes(canonicalCommand)) {
        const compositeToken =
          typeof entry.compositeScript === "string"
            ? `pnpm run ${entry.compositeScript}`
            : null;
        const compositeBody =
          typeof entry.compositeScript === "string"
            ? packageScripts[entry.compositeScript]
            : null;
        const compositeCoversCanonical =
          compositeToken !== null &&
          entry.tokens.length === 1 &&
          entry.tokens[0] === compositeToken &&
          typeof compositeBody === "string" &&
          workflowContainsExecutableToken(compositeBody, canonicalCommand);
        const workspaceUnitCoverage =
          name === "test:unit" &&
          canonicalCommand === "pnpm run test:unit" &&
          entry.coverageMode === "workspace-unit-suites" &&
          entry.tokens.length === WORKSPACE_UNIT_CI_TOKENS.length &&
          WORKSPACE_UNIT_CI_TOKENS.every((token) => entry.tokens.includes(token));
        if (!compositeCoversCanonical && !workspaceUnitCoverage) {
        problems.push(
            `${name}: workflow tokens must include the canonical command or use a mechanically verified composite/suite equivalent`,
        );
        }
      }
      for (const token of entry.tokens) {
        if (!workflowContainsExecutableToken(workflowRunText, token)) {
          problems.push(`${name}: GitHub workflow token missing: ${JSON.stringify(token)}`);
        }
      }
    } else if (!isSupportedLocalOnlyExclusion(entry)) {
      problems.push(
        `${name}: local-only exclusion must declare a substantive reason and supported dependency category ` +
        `(${LOCAL_ONLY_DEPENDENCIES.join(", ")})`,
      );
    } else {
      const canonicalCommand =
        typeof step.cmd === "string" ? step.cmd : entry.canonicalCommand;
      if (typeof canonicalCommand !== "string" || canonicalCommand.length === 0) {
        problems.push(`${name}: function-based excluded step must declare canonicalCommand`);
      } else if (workflowContainsExecutableToken(workflowRunText, canonicalCommand)) {
      problems.push(
        `${name}: stale local-only exclusion — its canonical command now runs in a pull-request workflow`,
      );
      }
    }
  }

  for (const name of Object.keys(coverage)) {
    if (!stepNames.has(name)) problems.push(`${name}: stale GitHub CI coverage entry`);
  }
  return problems;
}

/**
 * Extracts only executable `run:` command bodies from a workflow source.
 * Comments, step names, and other prose are deliberately omitted so merely
 * documenting a command cannot satisfy the parity contract after its step is
 * removed. Handles scalar commands and YAML literal/folded block commands.
 */
function stripUnquotedComment(value) {
  let singleQuoted = false;
  let doubleQuoted = false;
  let escaped = false;

  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && doubleQuoted) {
      escaped = true;
      continue;
    }
    if (char === "'" && !doubleQuoted) {
      singleQuoted = !singleQuoted;
      continue;
    }
    if (char === '"' && !singleQuoted) {
      doubleQuoted = !doubleQuoted;
      continue;
    }
    if (
      char === "#" &&
      !singleQuoted &&
      !doubleQuoted &&
      (index === 0 || /\s/.test(value[index - 1]))
    ) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value;
}

export function extractGithubWorkflowRunCommands(source) {
  const lines = source.split("\n");
  const commands = [];
  for (let index = 0; index < lines.length; index++) {
    const match = /^(\s*)run:\s*(.*)$/.exec(lines[index]);
    if (!match) continue;

    const indent = match[1].length;
    const value = stripUnquotedComment(match[2].trim());
    if (!/^[>|][+-]?$/.test(value)) {
      if (value.length > 0) commands.push(value);
      continue;
    }

    const block = [];
    while (index + 1 < lines.length) {
      const next = lines[index + 1];
      if (next.trim() === "") {
        block.push("");
        index++;
        continue;
      }
      const nextIndent = /^\s*/.exec(next)?.[0].length ?? 0;
      if (nextIndent <= indent) break;
      const commandLine = stripUnquotedComment(next.trim());
      if (commandLine.length > 0) block.push(commandLine);
      index++;
    }
    const command = block.join("\n").trim();
    if (command.length > 0) commands.push(command);
  }
  return commands;
}

export function extractGithubWorkflowRunText(source) {
  return extractGithubWorkflowRunCommands(source).join("\n");
}

/**
 * Returns GitHub event scopes which can execute a workflow. Scope matching is
 * intentionally conservative: a duplicate only matters when both commands can
 * run for the same PR or main-branch push.
 */
export function getGithubWorkflowScopes(source) {
  const lines = source.split("\n");
  const onIndex = lines.findIndex((line) => /^["']?on["']?:/.test(line));
  if (onIndex === -1) return [];

  const declaration = /^["']?on["']?:\s*(.*)$/.exec(lines[onIndex]);
  const inlineValue = stripUnquotedComment(declaration?.[1]?.trim() ?? "");
  let eventText = inlineValue;
  if (inlineValue.length === 0) {
    const block = [];
    for (let index = onIndex + 1; index < lines.length; index++) {
      const line = lines[index];
      if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
      if (!/^\s+/.test(line)) break;
      const eventLine = stripUnquotedComment(line.trim());
      if (eventLine.length > 0) block.push(eventLine);
    }
    eventText = block.join("\n");
  }

  const scopes = [];
  if (/\b(?:pull_request|pull_request_target)\b/.test(eventText)) {
    scopes.push("pull-request");
  }
  if (/\bpush\b/.test(eventText)) {
    scopes.push("push");
  }
  return scopes;
}

/**
 * Reads workflow files into executable command records. Workflow comments and
 * step names are excluded through extractGithubWorkflowRunText(), so prose
 * cannot make a command look covered.
 */
export function readGithubWorkflowRuns(rootDir) {
  const workflowsDir = resolve(rootDir, ".github", "workflows");
  try {
    return readdirSync(workflowsDir)
      .filter((file) => /\.(yml|yaml)$/.test(file))
      .sort()
      .map((file) => {
        const source = readFileSync(resolve(workflowsDir, file), "utf8");
        return {
          file,
          scopes: getGithubWorkflowScopes(source),
          commands: extractGithubWorkflowRunCommands(source)
            .filter((command) => command.trim().length > 0),
        };
      });
  } catch {
    return [];
  }
}

/**
 * Reads pull-request GitHub Actions workflow YAML files into one searchable
 * string. Main-only, scheduled, and manual-only workflows cannot satisfy the
 * parity contract because they do not protect pull requests.
 */
export function buildGithubWorkflowText(rootDir) {
  return readGithubWorkflowRuns(rootDir)
    .filter((workflow) => workflow.scopes.includes("pull-request"))
    .flatMap((workflow) => workflow.commands)
    .join("\n");
}

/**
 * Returns contract violations for fresh-database E2E workflow bootstrap.
 * Both GitHub jobs create empty Postgres service containers, so their executable
 * commands must use schema-derived push-force and must never invoke migrate.
 */
export function findE2eDatabaseBootstrapProblems(
  prWorkflowSource,
  mainWorkflowSource,
) {
  const required = "pnpm --filter @workspace/db run push-force";
  const forbidden = "pnpm --filter @workspace/db run migrate";
  const workflows = [
    ["ci-e2e-pr.yml", extractGithubWorkflowRunText(prWorkflowSource)],
    ["ci-e2e.yml", extractGithubWorkflowRunText(mainWorkflowSource)],
  ];
  const problems = [];

  for (const [name, runText] of workflows) {
    if (!runText.includes(required)) {
      problems.push(`${name}: fresh database bootstrap must run push-force`);
    }
    if (runText.includes(forbidden)) {
      problems.push(`${name}: fresh database bootstrap must not run migrate`);
    }
  }

  return problems;
}

function isBrowserDiscoveryCommand(command) {
  return /\bplaywright\s+test\b/.test(command) &&
    !isTargetedBrowserCommand(command);
}

function isTargetedBrowserCommand(command) {
  return /\bplaywright\s+test\b/.test(command) &&
    (
      /\btests\/e2e\/[^\s'"]+\.spec\.[cm]?[jt]sx?\b/.test(command) ||
      /(?:^|\s)(?:--grep|--project|--last-failed)(?:=|\s)/.test(command)
    );
}

function containsTestFile(command) {
  return /\b[^\s'"]+(?:\.test|\.spec)\.[cm]?[jt]sx?\b/.test(command);
}

function isUnitDiscoveryCommand(command) {
  if (isTargetedUnitCommand(command)) return false;
  return /\bpnpm(?:\s+-r)?\s+run\s+test:unit\b/.test(command) ||
    /\bpnpm\s+--filter\s+\S+\s+run\s+test:unit\b/.test(command) ||
    /\bvitest\s+run\s+--shard(?:=|\s)/.test(command);
}

function isTargetedUnitCommand(command) {
  const invokesUnitRunner =
    /\b(?:vitest\s+run|node\s+--(?:import\s+\S+\s+)?test)\b/.test(command) ||
    /\bpnpm(?:\s+--filter\s+\S+)?\s+run\s+test:unit\b/.test(command);
  return invokesUnitRunner && (
    containsTestFile(command) ||
    /(?:^|\s)(?:-t|--testNamePattern|--test-name-pattern|--grep|--project)(?:=|\s)/.test(command)
  );
}

function findPotentialStandaloneSuiteRuns(workflowRuns) {
  const potential = [];
  const scopes = new Set(workflowRuns.flatMap((workflow) => workflow.scopes));

  for (const scope of scopes) {
    const commands = workflowRuns.flatMap((workflow) =>
      workflow.scopes.includes(scope)
        ? workflow.commands.map((command) => ({ file: workflow.file, command }))
        : [],
    );
    const browserDiscoveryExists = commands.some(({ command }) => isBrowserDiscoveryCommand(command));
    const unitDiscoveryExists = commands.some(({ command }) => isUnitDiscoveryCommand(command));

    for (const entry of commands) {
      if (browserDiscoveryExists && isTargetedBrowserCommand(entry.command)) {
        potential.push({ ...entry, scope, suite: "browser" });
      }
      if (unitDiscoveryExists && isTargetedUnitCommand(entry.command)) {
        potential.push({ ...entry, scope, suite: "unit" });
      }
    }
  }
  return potential;
}

function matchesSuiteOverlapExclusion(candidate, exclusion) {
  return exclusion &&
    exclusion.workflow === candidate.file &&
    exclusion.scope === candidate.scope &&
    typeof exclusion.command === "string" &&
    exclusion.command.length > 0 &&
    candidate.command === exclusion.command &&
    typeof exclusion.reason === "string" &&
    exclusion.reason.trim().length >= 20;
}

/**
 * Finds targeted unit/browser runs that duplicate discovery-based coverage in
 * the same GitHub event scope and have no recorded intentional-overlap reason.
 */
export function findRedundantStandaloneSuiteRuns(
  workflowRuns,
  exclusions = GITHUB_SUITE_OVERLAP_EXCLUSIONS,
) {
  return findPotentialStandaloneSuiteRuns(workflowRuns).filter(
    (candidate) => !exclusions.some((exclusion) => matchesSuiteOverlapExclusion(candidate, exclusion)),
  );
}

/**
 * Reports malformed or stale intentional-overlap declarations. An exclusion is
 * stale when the referenced executable command disappears or is no longer an
 * actual duplicate, so exemptions cannot accumulate unnoticed.
 */
export function findSuiteOverlapExclusionProblems(
  workflowRuns,
  exclusions = GITHUB_SUITE_OVERLAP_EXCLUSIONS,
) {
  const potential = findPotentialStandaloneSuiteRuns(workflowRuns);
  const problems = [];
  for (const exclusion of exclusions) {
    if (
      typeof exclusion?.workflow !== "string" ||
      !["pull-request", "push"].includes(exclusion?.scope) ||
      typeof exclusion?.command !== "string" ||
      exclusion.command.length === 0 ||
      typeof exclusion?.reason !== "string" ||
      exclusion.reason.trim().length < 20
    ) {
      problems.push(
        "malformed suite-overlap exclusion (workflow, scope, exact command, and substantive reason are required)",
      );
      continue;
    }
    if (!potential.some((candidate) => matchesSuiteOverlapExclusion(candidate, exclusion))) {
      problems.push(
        `${exclusion.workflow} (${exclusion.scope}): stale suite-overlap exclusion for exact command`,
      );
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const ciSteps = getValidationSteps("check-runner-step-sync").map((s) => s.name);

  let failed = false;

  const uncovered = findUncoveredChecks(pkg, ciSteps);
  if (uncovered.length > 0) {
    failed = true;
    console.error("[check-runner-step-sync] FAIL — check:* script(s) defined in package.json but never run in CI:");
    for (const n of uncovered) console.error(`  ${n}`);
    console.error(
      "  Fix: add the script as a step in scripts/validation-steps.mjs (the shared\n" +
      "  step list used by run-tier.mjs and test-all-steps.mjs), OR add it to\n" +
      "  CI_COVERAGE_ALLOWLIST in scripts/check-runner-step-sync.mjs with a reason\n" +
      "  explaining where its coverage comes from.",
    );
  }

  const stale = findStaleAllowlistEntries(pkg, ciSteps);
  if (stale.length > 0) {
    failed = true;
    console.error("[check-runner-step-sync] FAIL — stale CI_COVERAGE_ALLOWLIST entr(ies):");
    for (const n of stale) console.error(`  ${n} (script removed from package.json, or now runs in the CI sequence)`);
    console.error("  Fix: remove the entry from CI_COVERAGE_ALLOWLIST in scripts/check-runner-step-sync.mjs.");
  }

  const githubParityProblems = findGithubCiParityProblems(
    getValidationSteps("check-runner-step-sync"),
    buildGithubWorkflowText(root),
    GITHUB_CI_COVERAGE,
    pkg.scripts,
  );
  if (githubParityProblems.length > 0) {
    failed = true;
    console.error("[check-runner-step-sync] FAIL — canonical validation step is missing GitHub CI coverage:");
    for (const problem of githubParityProblems) console.error(`  ${problem}`);
    console.error(
      "  Fix: add the portable command to a pull-request GitHub workflow and its token to\n" +
      "  GITHUB_CI_COVERAGE, OR add a substantive local-only exclusion reason there.",
    );
  }

  const e2eBootstrapProblems = findE2eDatabaseBootstrapProblems(
    readFileSync(
      resolve(root, ".github", "workflows", "ci-e2e-pr.yml"),
      "utf8",
    ),
    readFileSync(resolve(root, ".github", "workflows", "ci-e2e.yml"), "utf8"),
  );
  if (e2eBootstrapProblems.length > 0) {
    failed = true;
    console.error(
      "[check-runner-step-sync] FAIL — E2E fresh-database bootstrap drifted:",
    );
    for (const problem of e2eBootstrapProblems) console.error(`  ${problem}`);
    console.error(
      "  Fix: initialize each empty Postgres service with `pnpm --filter @workspace/db run push-force`;\n" +
        "  the migration journal cannot bootstrap a fresh database.",
    );
  }

  const workflowRuns = readGithubWorkflowRuns(root);
  const redundantSuiteRuns = findRedundantStandaloneSuiteRuns(workflowRuns);
  if (redundantSuiteRuns.length > 0) {
    failed = true;
    console.error("[check-runner-step-sync] FAIL — targeted behavioral test run duplicates discovery coverage:");
    for (const run of redundantSuiteRuns) {
      console.error(`  ${run.file} (${run.scope}, ${run.suite}): ${run.command}`);
    }
    console.error(
      "  Fix: let the test join its package's test:unit or Playwright discovery suite instead.\n" +
      "  If isolated execution is required, record the exact executable command and a substantive\n" +
      "  reason in GITHUB_SUITE_OVERLAP_EXCLUSIONS.",
    );
  }

  const suiteOverlapProblems = findSuiteOverlapExclusionProblems(workflowRuns);
  if (suiteOverlapProblems.length > 0) {
    failed = true;
    console.error("[check-runner-step-sync] FAIL — suite-overlap exclusion problem(s):");
    for (const problem of suiteOverlapProblems) console.error(`  ${problem}`);
    console.error(
      "  Fix: remove stale exclusions, or provide the executable workflow command and a substantive reason.",
    );
  }

  // Orphaned check FILES: check-*.{mjs,sh} on disk referenced nowhere.
  const checkFiles = listCheckFiles(__dirname);
  const referenceText = buildReferenceText(root, __dirname);

  const orphans = findOrphanCheckFiles(checkFiles, referenceText);
  if (orphans.length > 0) {
    failed = true;
    console.error("[check-runner-step-sync] FAIL — check-* file(s) in scripts/ referenced nowhere (no package.json script, no workflow, no other script):");
    for (const f of orphans) console.error(`  scripts/${f}`);
    console.error(
      "  Fix: wire the file up (package.json script + scripts/validation-steps.mjs\n" +
      "  step, GitHub workflow, or invoking script), delete it, OR add it to\n" +
      "  ORPHAN_FILE_ALLOWLIST in scripts/check-runner-step-sync.mjs with a reason.",
    );
  }

  const staleOrphans = findStaleOrphanAllowlistEntries(checkFiles, referenceText);
  if (staleOrphans.length > 0) {
    failed = true;
    console.error("[check-runner-step-sync] FAIL — stale ORPHAN_FILE_ALLOWLIST entr(ies):");
    for (const f of staleOrphans) console.error(`  ${f} (file removed from scripts/, or now referenced somewhere)`);
    console.error("  Fix: remove the entry from ORPHAN_FILE_ALLOWLIST in scripts/check-runner-step-sync.mjs.");
  }

  // Guard: no check script may re-declare a local IGNORED_DIRS constant.
  // All walkers must import it from scripts/lib/ignored-dirs.mjs instead.
  const ignoredDirsViolators = findLocalIgnoredDirsDeclarations(__dirname);
  if (ignoredDirsViolators.length > 0) {
    failed = true;
    console.error("[check-runner-step-sync] FAIL — check script(s) re-declare a local IGNORED_DIRS instead of importing from scripts/lib/ignored-dirs.mjs:");
    for (const f of ignoredDirsViolators) console.error(`  scripts/${f}`);
    console.error(
      "  Fix: remove the local `const IGNORED_DIRS = new Set(...)` declaration and\n" +
      "  add `import { IGNORED_DIRS } from \"./lib/ignored-dirs.mjs\";` instead.\n" +
      "  Scripts needing extra entries beyond the base set should use a different\n" +
      "  local name (e.g. SKIP_DIRS) built by spreading: new Set([...IGNORED_DIRS, ...]).",
    );
  }

  if (failed) process.exit(1);

  console.log(
    `[check-runner-step-sync] OK — ${ciSteps.length} shared steps; GitHub parity covered; ` +
    `all check:* scripts covered (${Object.keys(CI_COVERAGE_ALLOWLIST).length} allowlisted); ` +
    `all ${checkFiles.length} check-* files referenced (${Object.keys(ORPHAN_FILE_ALLOWLIST).length} allowlisted).`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
