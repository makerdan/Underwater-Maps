#!/usr/bin/env node
/**
 * Validate the tracked catalog of pre-existing validation failures.
 *
 * This checker is deliberately independent from test execution. Catalog
 * membership is provenance for human triage; it never filters, skips, or
 * changes a test command.
 */
import { readFileSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const CATALOG_RELATIVE_PATH = "docs/validation/failure-baseline.json";
export const KNOWN_STATUSES = [
  "active",
  "needs-review",
  "resolved",
  "intermittent",
  "environment-limited",
];
export const KNOWN_TIERS = ["fast", "standard", "standard-plus", "heavy", "standalone"];
export const KNOWN_CLASSIFICATIONS = [
  "product",
  "test",
  "tooling",
  "dependency",
  "environment",
];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CATALOG_KEYS = ["catalogVersion", "catalogDate", "entries"];
const ENTRY_KEYS = [
  "id",
  "suite",
  "test",
  "failureSignature",
  "classification",
  "evidence",
  "ownership",
  "firstVerifiedDate",
  "lastVerifiedDate",
  "affectedTiers",
  "reviewDeadline",
  "status",
  "statusHistory",
  "repositoryReferences",
  "resolution",
];
const STATUS_HISTORY_KEYS = ["status", "date", "note"];
const ALLOWED_TRANSITIONS = {
  active: new Set(["needs-review", "resolved", "intermittent", "environment-limited"]),
  "needs-review": new Set(["active", "resolved", "intermittent", "environment-limited"]),
  intermittent: new Set(["active", "needs-review", "resolved"]),
  "environment-limited": new Set(["active", "needs-review", "resolved"]),
  resolved: new Set(),
};

const here = resolve(fileURLToPath(import.meta.url), "..");
const defaultRoot = resolve(here, "..");

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unknownKeys(value, allowed) {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function isValidDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function checkDate(errors, value, label) {
  if (!isValidDate(value)) {
    errors.push(`${label} must be an ISO calendar date (YYYY-MM-DD)`);
    return false;
  }
  return true;
}

function checkNonEmptyString(errors, value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${label} must be a non-empty string`);
    return false;
  }
  return true;
}

function checkRepositoryPath(errors, repoRoot, pathValue, label) {
  if (!checkNonEmptyString(errors, pathValue, label)) return;
  if (pathValue.startsWith("/") || pathValue.split("/").includes("..")) {
    errors.push(`${label} must be a repository-relative path`);
    return;
  }
  const absolutePath = resolve(repoRoot, pathValue);
  const relativePath = relative(repoRoot, absolutePath);
  if (relativePath.startsWith("..") || relativePath.includes("..")) {
    errors.push(`${label} must stay inside the repository`);
    return;
  }
  try {
    if (!statSync(absolutePath).isFile()) {
      errors.push(`${label} does not reference a file: ${pathValue}`);
    }
  } catch {
    errors.push(`${label} references a missing repository file: ${pathValue}`);
  }
}

function checkExactKeys(errors, value, allowed, label) {
  const extra = unknownKeys(value, allowed);
  if (extra.length > 0) {
    errors.push(`${label} has unknown field(s): ${extra.join(", ")}`);
  }
}

function checkEvidence(errors, entry, repoRoot) {
  const evidence = entry.evidence;
  if (!isPlainObject(evidence)) {
    errors.push(`${entry.id}.evidence must be an object`);
    return;
  }
  checkExactKeys(errors, evidence, ["sources", "observations", "authoritative", "summary"], `${entry.id}.evidence`);
  if (!Array.isArray(evidence.sources) || evidence.sources.length === 0) {
    errors.push(`${entry.id}.evidence.sources must contain at least one audit source`);
  } else {
    evidence.sources.forEach((source, index) => {
      const label = `${entry.id}.evidence.sources[${index}]`;
      if (!isPlainObject(source)) {
        errors.push(`${label} must be an object`);
        return;
      }
      checkExactKeys(errors, source, ["path", "locator"], label);
      checkRepositoryPath(errors, repoRoot, source.path, `${label}.path`);
      checkNonEmptyString(errors, source.locator, `${label}.locator`);
    });
  }
  if (!Array.isArray(evidence.observations) || evidence.observations.length === 0) {
    errors.push(`${entry.id}.evidence.observations must contain at least one observation`);
  } else {
    evidence.observations.forEach((observation, index) => {
      const label = `${entry.id}.evidence.observations[${index}]`;
      if (!isPlainObject(observation)) {
        errors.push(`${label} must be an object`);
        return;
      }
      checkExactKeys(errors, observation, ["date", "outcome", "command", "result"], label);
      checkDate(errors, observation.date, `${label}.date`);
      if (!["fail", "pass", "blocked"].includes(observation.outcome)) {
        errors.push(`${label}.outcome must be fail, pass, or blocked`);
      }
      checkNonEmptyString(errors, observation.command, `${label}.command`);
      checkNonEmptyString(errors, observation.result, `${label}.result`);
    });
  }
  if (typeof evidence.authoritative !== "boolean") {
    errors.push(`${entry.id}.evidence.authoritative must be a boolean`);
  }
  checkNonEmptyString(errors, evidence.summary, `${entry.id}.evidence.summary`);
}

function checkLifecycle(errors, entry, asOf) {
  if (!KNOWN_STATUSES.includes(entry.status)) {
    errors.push(`${entry.id}.status must be one of: ${KNOWN_STATUSES.join(", ")}`);
  }
  if (!Array.isArray(entry.statusHistory) || entry.statusHistory.length === 0) {
    errors.push(`${entry.id}.statusHistory must contain at least one transition`);
    return;
  }
  let previousDate = null;
  entry.statusHistory.forEach((transition, index) => {
    const label = `${entry.id}.statusHistory[${index}]`;
    if (!isPlainObject(transition)) {
      errors.push(`${label} must be an object`);
      return;
    }
    checkExactKeys(errors, transition, STATUS_HISTORY_KEYS, label);
    if (!KNOWN_STATUSES.includes(transition.status)) {
      errors.push(`${label}.status must be a known lifecycle status`);
    }
    if (checkDate(errors, transition.date, `${label}.date`) && previousDate && transition.date < previousDate) {
      errors.push(`${label}.date must not precede the prior lifecycle date`);
    }
    if (isValidDate(transition.date)) previousDate = transition.date;
    checkNonEmptyString(errors, transition.note, `${label}.note`);
    if (index > 0) {
      const priorStatus = entry.statusHistory[index - 1].status;
      if (
        KNOWN_STATUSES.includes(priorStatus) &&
        KNOWN_STATUSES.includes(transition.status) &&
        !ALLOWED_TRANSITIONS[priorStatus].has(transition.status)
      ) {
        errors.push(`${entry.id} has invalid lifecycle transition: ${priorStatus} -> ${transition.status}`);
      }
    }
  });
  const lastTransition = entry.statusHistory[entry.statusHistory.length - 1];
  if (lastTransition.status !== entry.status) {
    errors.push(`${entry.id}.status must match the final statusHistory status`);
  }
  if (entry.status === "resolved") {
    if (!isPlainObject(entry.resolution)) {
      errors.push(`${entry.id}.resolution is required for resolved records`);
    } else {
      checkExactKeys(errors, entry.resolution, ["date", "summary", "evidence"], `${entry.id}.resolution`);
      checkDate(errors, entry.resolution.date, `${entry.id}.resolution.date`);
      checkNonEmptyString(errors, entry.resolution.summary, `${entry.id}.resolution.summary`);
      checkNonEmptyString(errors, entry.resolution.evidence, `${entry.id}.resolution.evidence`);
    }
  } else if (entry.resolution !== null) {
    errors.push(`${entry.id}.resolution must be null until the record is resolved`);
  }
  if (entry.status === "active") {
    if (entry.evidence?.authoritative !== true) {
      errors.push(`${entry.id}.active records require authoritative evidence`);
    }
    if (isValidDate(entry.reviewDeadline) && entry.reviewDeadline < asOf) {
      errors.push(`${entry.id}.active reviewDeadline ${entry.reviewDeadline} has expired as of ${asOf}`);
    }
  } else if (entry.status === "environment-limited" && entry.classification !== "environment") {
    errors.push(`${entry.id}.environment-limited records must use environment classification`);
  } else if (entry.status === "intermittent") {
    const outcomes = new Set((entry.evidence?.observations ?? []).map((observation) => observation.outcome));
    if (!outcomes.has("pass") || !outcomes.has("fail")) {
      errors.push(`${entry.id}.intermittent records require both pass and fail observations`);
    }
  }
  if (entry.evidence?.authoritative === true && entry.status !== "active") {
    errors.push(`${entry.id} cannot mark non-active evidence authoritative`);
  }
}

export function validateBaselineCatalog(catalog, options = {}) {
  const repoRoot = resolve(options.repoRoot ?? defaultRoot);
  const asOf = options.asOf ?? new Date().toISOString().slice(0, 10);
  const errors = [];
  checkDate(errors, asOf, "asOf");
  if (!isPlainObject(catalog)) {
    return { errors: ["catalog must be a JSON object"] };
  }
  checkExactKeys(errors, catalog, CATALOG_KEYS, "catalog");
  if (catalog.catalogVersion !== 1) {
    errors.push("catalog.catalogVersion must be 1");
  }
  checkDate(errors, catalog.catalogDate, "catalog.catalogDate");
  if (isValidDate(catalog.catalogDate) && isValidDate(asOf) && catalog.catalogDate > asOf) {
    errors.push(`catalog.catalogDate ${catalog.catalogDate} cannot be after asOf ${asOf}`);
  }
  if (!Array.isArray(catalog.entries) || catalog.entries.length === 0) {
    errors.push("catalog.entries must contain at least one record");
    return { errors };
  }
  const ids = new Set();
  catalog.entries.forEach((entry, index) => {
    const label = `entries[${index}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${label} must be an object`);
      return;
    }
    checkExactKeys(errors, entry, ENTRY_KEYS, label);
    if (!/^BASE-[A-Z0-9-]+$/.test(entry.id ?? "")) {
      errors.push(`${label}.id must match BASE-[A-Z0-9-]+`);
    } else if (ids.has(entry.id)) {
      errors.push(`duplicate baseline id: ${entry.id}`);
    } else {
      ids.add(entry.id);
    }
    checkNonEmptyString(errors, entry.suite, `${entry.id ?? label}.suite`);
    checkNonEmptyString(errors, entry.test, `${entry.id ?? label}.test`);
    if (typeof entry.failureSignature !== "string" || entry.failureSignature.trim().length < 20) {
      errors.push(`${entry.id ?? label}.failureSignature must be at least 20 characters`);
    }
    if (!KNOWN_CLASSIFICATIONS.includes(entry.classification)) {
      errors.push(`${entry.id ?? label}.classification must be one of: ${KNOWN_CLASSIFICATIONS.join(", ")}`);
    }
    checkEvidence(errors, entry, repoRoot);
    if (!isPlainObject(entry.ownership)) {
      errors.push(`${entry.id ?? label}.ownership must be an object`);
    } else {
      checkExactKeys(errors, entry.ownership, ["owner", "rationale"], `${entry.id}.ownership`);
      checkNonEmptyString(errors, entry.ownership.owner, `${entry.id}.ownership.owner`);
      checkNonEmptyString(errors, entry.ownership.rationale, `${entry.id}.ownership.rationale`);
    }
    const firstValid = checkDate(errors, entry.firstVerifiedDate, `${entry.id ?? label}.firstVerifiedDate`);
    const lastValid = checkDate(errors, entry.lastVerifiedDate, `${entry.id ?? label}.lastVerifiedDate`);
    if (firstValid && lastValid && entry.firstVerifiedDate > entry.lastVerifiedDate) {
      errors.push(`${entry.id}.firstVerifiedDate cannot be after lastVerifiedDate`);
    }
    if (!Array.isArray(entry.affectedTiers) || entry.affectedTiers.length === 0) {
      errors.push(`${entry.id}.affectedTiers must contain at least one validation tier`);
    } else {
      const tiers = new Set(entry.affectedTiers);
      if (tiers.size !== entry.affectedTiers.length) {
        errors.push(`${entry.id}.affectedTiers must not contain duplicates`);
      }
      for (const tier of entry.affectedTiers) {
        if (!KNOWN_TIERS.includes(tier)) errors.push(`${entry.id}.affectedTiers contains unknown tier: ${tier}`);
      }
    }
    checkDate(errors, entry.reviewDeadline, `${entry.id ?? label}.reviewDeadline`);
    checkLifecycle(errors, entry, asOf);
    if (!Array.isArray(entry.repositoryReferences) || entry.repositoryReferences.length === 0) {
      errors.push(`${entry.id}.repositoryReferences must contain at least one file`);
    } else {
      entry.repositoryReferences.forEach((pathValue, referenceIndex) => {
        checkRepositoryPath(errors, repoRoot, pathValue, `${entry.id}.repositoryReferences[${referenceIndex}]`);
      });
    }
  });
  return {
    errors,
    entryCount: catalog.entries.length,
    authoritativeActiveCount: catalog.entries.filter(
      (entry) => entry.status === "active" && entry.evidence?.authoritative === true,
    ).length,
  };
}

function parseArgs(argv) {
  const args = { catalog: resolve(defaultRoot, CATALOG_RELATIVE_PATH), repoRoot: defaultRoot };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--catalog" || argument === "--repo-root" || argument === "--as-of") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      if (argument === "--catalog") args.catalog = resolve(value);
      if (argument === "--repo-root") args.repoRoot = resolve(value);
      if (argument === "--as-of") args.asOf = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return args;
}

export function runValidationBaselineCheck(options = {}) {
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(options.catalog, "utf8"));
  } catch (error) {
    return { errors: [`unable to read or parse ${options.catalog}: ${error.message}`] };
  }
  return validateBaselineCatalog(catalog, options);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = runValidationBaselineCheck(options);
    if (result.errors.length > 0) {
      for (const error of result.errors) console.error(`[check-validation-baseline] ${error}`);
      process.exitCode = 1;
    } else {
      console.log(
        `[check-validation-baseline] OK — ${result.entryCount} entries; ` +
          `${result.authoritativeActiveCount} authoritative active record(s); as of ${options.asOf ?? "today"}`,
      );
    }
  } catch (error) {
    console.error(`[check-validation-baseline] ${error.message}`);
    process.exitCode = 1;
  }
}