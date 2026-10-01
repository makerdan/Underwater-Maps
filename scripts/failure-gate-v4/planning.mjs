import { lstat, readFile, realpath } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { isAbsolute, resolve, sep } from "node:path";
import { digestJson, sha256 } from "./canonical.mjs";
import { captureWorkspaceSnapshot } from "./snapshot.mjs";

const BASELINE_ID = /^BASE-[A-Z0-9-]+$/;
const DIGEST = /^[0-9a-f]{64}$/;
const CATALOG_REFERENCE = "docs/validation/failure-baseline.json";

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function meaningful(value) {
  if (!nonEmpty(value)) return false;
  const text = value.trim();
  return !(text.startsWith("<") && text.endsWith(">")) &&
    !/^(?:tbd|todo|fill in|n\/a)$/i.test(text) &&
    !/fill in/i.test(text);
}

function validDate(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function safeProjectPath(reference) {
  if (!nonEmpty(reference) || isAbsolute(reference) || reference.includes("\\") ||
      reference.split("/").some((part) => part === "" || part === "." || part === "..") ||
      /[\u0000-\u001f\u007f]/.test(reference)) {
    throw new Error("planning projection reference must be a safe project-relative path");
  }
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}

async function readTrackedFile(projectRoot, reference) {
  safeProjectPath(reference);
  const root = await realpath(resolve(projectRoot));
  const path = resolve(root, reference);
  if (!path.startsWith(`${root}${sep}`)) throw new Error("planning projection escapes the project root");
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || await realpath(path) !== path) {
    throw new Error("planning projection must be a regular non-symlink file");
  }
  let trackedPath;
  try {
    trackedPath = git(root, ["ls-files", "--error-unmatch", "--", reference]);
  } catch {
    throw new Error(`planning projection '${reference}' is not tracked`);
  }
  if (trackedPath !== reference) throw new Error("tracked planning projection did not resolve exactly");
  return { root, path, bytes: await readFile(path) };
}

/**
 * Load the authoritative tracked baseline catalog. The returned wrapper is
 * intentionally required by validatePlanningGuards; an arbitrary caller-built
 * entries array is not an authority source.
 */
export async function loadTrackedBaselineCatalog({
  projectRoot,
  reference = CATALOG_REFERENCE,
} = {}) {
  const { root, bytes } = await readTrackedFile(projectRoot, reference);
  try {
    git(root, ["diff", "--quiet", "HEAD", "--", reference]);
  } catch {
    throw new Error("tracked baseline catalog has uncommitted changes and is not authoritative");
  }
  let catalog;
  try {
    catalog = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("tracked baseline catalog is not valid JSON");
  }
  if (!record(catalog) || !Array.isArray(catalog.entries) ||
      !Number.isInteger(catalog.catalogVersion) || catalog.catalogVersion < 1) {
    throw new Error("tracked baseline catalog has an invalid catalog shape");
  }
  const ids = catalog.entries.map((entry) => entry?.id);
  if (catalog.entries.some((entry) => !record(entry) || !nonEmpty(entry.id)) ||
      new Set(ids).size !== ids.length) {
    throw new Error("tracked baseline catalog has malformed or duplicate entry IDs");
  }
  return Object.freeze({
    tracked: true,
    reference,
    sha256: sha256(bytes),
    catalog,
  });
}

function baselineReferences(plan) {
  const baselines = plan.baselines ?? {};
  if (!record(baselines)) throw new Error("plan baselines must be an object");
  const ignored = baselines.ignore ?? [];
  const owned = baselines.owned ?? [];
  for (const [label, references] of [["ignored", ignored], ["owned", owned]]) {
    if (!Array.isArray(references)) throw new Error(`plan baselines.${label} must be an array`);
    const seen = new Set();
    for (const reference of references) {
      if (!record(reference) || !BASELINE_ID.test(reference.id ?? "") ||
          !nonEmpty(reference.owner) || seen.has(reference.id)) {
        throw new Error(`plan baselines.${label} must contain unique { id, owner } references`);
      }
      seen.add(reference.id);
    }
  }
  const ignoredIds = new Set(ignored.map((item) => item.id));
  if (owned.some((item) => ignoredIds.has(item.id))) {
    throw new Error("a baseline cannot be both ignored and an owned repair");
  }
  return { ignored, owned };
}

function validateBaselineReferences(references, entriesById, asOf, kind, tier, errors) {
  for (const reference of references) {
    const entry = entriesById.get(reference.id);
    if (!entry) {
      errors.push(`baseline '${reference.id}' is absent from the tracked catalog`);
      continue;
    }
    if (!record(entry.ownership) || entry.ownership.owner !== reference.owner) {
      errors.push(`baseline '${reference.id}' ownership does not exactly match its catalog owner`);
      continue;
    }
    if (kind === "ignored" &&
        (entry.status !== "active" || entry.evidence?.authoritative !== true ||
         !validDate(entry.reviewDeadline) || !validDate(asOf) || asOf > entry.reviewDeadline)) {
      errors.push(`ignored baseline '${reference.id}' is not active, authoritative, and unexpired`);
      continue;
    }
    if (kind === "ignored" && (!Array.isArray(entry.affectedTiers) ||
        !entry.affectedTiers.includes(tier))) {
      errors.push(`ignored baseline '${reference.id}' does not apply to the selected tier`);
    }
  }
}

function validateRegressionGuard(guard, errors) {
  if (!record(guard)) {
    errors.push("gate tasks require a Regression Guard");
    return;
  }
  if (nonEmpty(guard.selfSatisfying)) return;
  const fields = ["covers", "testLocation", "whatItChecks"];
  const missing = fields.filter((field) => !meaningful(guard[field]));
  if (missing.length) {
    errors.push(`Regression Guard requires meaningful ${missing.join(", ")} fields or selfSatisfying`);
  }
}

async function validateLegacyProjection({ task, projectRoot, errors }) {
  const legacy = task.plan.legacyPlan;
  if (legacy === undefined) return;
  if (!record(legacy) || !nonEmpty(legacy.reference) || !DIGEST.test(legacy.sha256 ?? "")) {
    errors.push("legacyPlan must bind a tracked reference and lowercase SHA-256 digest");
    return;
  }
  try {
    const { bytes } = await readTrackedFile(projectRoot, legacy.reference);
    if (sha256(bytes) !== legacy.sha256) {
      errors.push("tracked legacy Markdown projection digest differs from the reserved plan");
      return;
    }
    const content = bytes.toString("utf8");
    const command = content.match(/^\s*\*\*Command:\*\*\s+`([^`]+)`\s*$/m)?.[1];
    const why = content.match(/^\s*\*\*Why:\*\*\s*(.+?)\s*$/m)?.[1];
    const noEscalate = content.match(/^\s*\*\*Do not escalate:\*\*\s*(.+?)\s*$/m)?.[1];
    const validation = record(task.plan.validation) ? task.plan.validation : {};
    if (command !== validation.tier || why !== validation.why ||
        noEscalate !== validation.doNotEscalate) {
      errors.push("legacy Markdown tier, Why, or Do not escalate fields do not match the canonical JSON plan");
    }
  } catch (error) {
    errors.push(`legacy Markdown projection is not safely bound: ${error.message}`);
  }
}

/**
 * Validate bounded planning guards for a reserved draft. No test or arbitrary
 * command is launched. Plan shape:
 *   validation: { tier, why, doNotEscalate, maximumTier }
 *   baselines: { ignore: [{id, owner}], owned: [{id, owner}] }
 *   regressionGuard: { covers, testLocation, whatItChecks } OR {selfSatisfying}
 *
 * Required input task is the store's reserved task record (plan and planDigest
 * included); tierPolicy is its registered policy entry; baselineCatalog must
 * come from loadTrackedBaselineCatalog.
 */
export async function validatePlanningGuards({
  task,
  tierPolicy,
  registeredTiers,
  baselineCatalog,
  projectRoot,
  asOf = new Date().toISOString().slice(0, 10),
  gateTask = true,
} = {}) {
  const errors = [];
  if (!record(task) || !["draft", "active"].includes(task.status)) {
    throw new TypeError("planning guards require a reserved draft or active task record");
  }
  if (!/^TASK-\d{6,}$/.test(task.taskId ?? "") || !nonEmpty(task.projectNamespace) ||
      !Number.isInteger(task.planVersion) || task.planVersion < 1 ||
      !record(task.plan) || !DIGEST.test(task.planDigest ?? "") ||
      digestJson(task.plan) !== task.planDigest ||
      task.plan.taskId !== task.taskId ||
      task.plan.projectNamespace !== task.projectNamespace ||
      task.plan.planVersion !== task.planVersion) {
    throw new Error("reserved task plan is not the exact canonical JSON record bound to its identity and digest");
  }
  if (!validDate(asOf)) errors.push("planning asOf must be a valid UTC calendar date");
  if (!record(tierPolicy)) throw new TypeError("registered tier policy is required");
  const policyTier = tierPolicy.tierName ?? tierPolicy.tier;
  if (!nonEmpty(task.requestedTier) || policyTier !== task.requestedTier) {
    errors.push("reserved requested tier does not match the supplied registered tier policy");
  }
  if (!nonEmpty(task.tierDefinitionDigest) ||
      tierPolicy.tierDefinitionDigest !== task.tierDefinitionDigest) {
    errors.push("reserved tier-definition digest does not match the supplied registered tier policy");
  }
  if (Array.isArray(registeredTiers) && !registeredTiers.includes(task.requestedTier)) {
    errors.push("reserved requested tier is not in the registered tier list");
  }
  const validation = task.plan.validation;
  if (!record(validation) || validation.tier !== task.requestedTier ||
      !meaningful(validation.why)) {
    errors.push("plan validation requires the exact reserved tier and a meaningful Why");
  }
  const doNotEscalate = validation?.doNotEscalate;
  const namesBoundTier = nonEmpty(doNotEscalate) &&
    (doNotEscalate.includes(task.requestedTier) ||
      /^\s*run only this authorized tier\b/i.test(doNotEscalate));
  const explicitlyProhibitsEscalation = nonEmpty(doNotEscalate) &&
    (/do not escalate|never escalate|no escalation/i.test(doNotEscalate) ||
      /^\s*run only this authorized tier\b/i.test(doNotEscalate));
  if (!record(validation) || validation.maximumTier !== task.requestedTier ||
      validation.noEscalation !== true ||
      !explicitlyProhibitsEscalation ||
      !namesBoundTier) {
    errors.push("plan must explicitly prohibit escalation and cap the maximum tier at the reserved tier");
  }

  const catalog = baselineCatalog?.catalog;
  if (baselineCatalog?.tracked !== true || !record(catalog) || !Array.isArray(catalog.entries) ||
      !DIGEST.test(baselineCatalog.sha256 ?? "")) {
    errors.push("baseline references require a verified tracked baseline catalog");
  } else {
    try {
      const { ignored, owned } = baselineReferences(task.plan);
      const entriesById = new Map(catalog.entries.map((entry) => [entry.id, entry]));
      validateBaselineReferences(ignored, entriesById, asOf, "ignored", task.requestedTier, errors);
      validateBaselineReferences(owned, entriesById, asOf, "owned", task.requestedTier, errors);
      // Preserve owned repair obligations even after expiry/revocation; validation
      // intentionally checks their identity/owner but not current status or deadline.
      const ownedBaselineIds = owned.map((entry) => entry.id);
      if (gateTask) validateRegressionGuard(task.plan.regressionGuard, errors);
      await validateLegacyProjection({ task, projectRoot, errors });
      return Object.freeze({
        ok: errors.length === 0,
        errors: Object.freeze(errors),
        purpose: "planning_guards",
        satisfiesRequiredValidation: false,
        taskId: task.taskId,
        tier: task.requestedTier,
        ignoredBaselineIds: Object.freeze(ignored.map((entry) => entry.id)),
        ownedBaselineIds: Object.freeze(ownedBaselineIds),
        baselineCatalogReference: baselineCatalog.reference,
        baselineCatalogDigest: baselineCatalog.sha256,
      });
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (gateTask) validateRegressionGuard(task.plan?.regressionGuard, errors);
  await validateLegacyProjection({ task, projectRoot, errors });
  return Object.freeze({
    ok: false,
    errors: Object.freeze(errors),
    purpose: "planning_guards",
    satisfiesRequiredValidation: false,
    taskId: task.taskId,
    tier: task.requestedTier,
  });
}

/**
 * Capture a pre-edit workspace observation independently of planning guards.
 * It is explicitly planning-only and can never be task validation evidence.
 */
export async function capturePlanningBaseline({ projectRoot, task } = {}) {
  if (!record(task) || task.status !== "draft" || !nonEmpty(task.taskId)) {
    throw new TypeError("baseline discovery requires a reserved draft task");
  }
  const snapshot = await captureWorkspaceSnapshot(projectRoot);
  return Object.freeze({
    purpose: "baseline_discovery",
    label: "planning baseline snapshot (not required-tier evidence)",
    satisfiesRequiredValidation: false,
    taskId: task.taskId,
    capturedAt: new Date().toISOString(),
    snapshot,
  });
}