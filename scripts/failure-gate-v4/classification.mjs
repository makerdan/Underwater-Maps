const OUTCOMES = Object.freeze({
  BLOCKED: "blocked",
  IGNORED: "ignored-baseline",
  OWNED_REQUIRED: "owned-repair-required",
  OWNED_PROVEN: "owned-repair-proven",
  PREEXISTING: "pre-existing-unlisted",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(value[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function exactIdentity(left, right) {
  return isRecord(left) && isRecord(right) &&
    left.suite === right.suite &&
    left.test === right.test &&
    left.failureSignature === right.failureSignature &&
    canonical(left.environment) === canonical(right.environment);
}

function baselineMatches(entry, observed) {
  if (!isRecord(entry) ||
      entry.suite !== observed.suite ||
      entry.test !== observed.test ||
      entry.failureSignature !== observed.failureSignature) return false;

  // The tracked catalog has no environment field: applicableVariants, when
  // present, identifies the exact environment variant. Otherwise affectedTiers
  // identifies the exact validation tier. Neither missing field is a wildcard.
  if (Object.hasOwn(entry, "environment") &&
      (!isRecord(entry.environment) ||
       canonical(entry.environment) !== canonical(observed.environment))) return false;
  if (!Object.hasOwn(entry, "environment")) {
    if (Object.hasOwn(entry, "applicableVariants")) {
      if (!Array.isArray(entry.applicableVariants) ||
          typeof observed.environment.variant !== "string" ||
          !observed.environment.variant ||
          !entry.applicableVariants.includes(observed.environment.variant)) return false;
    } else if (!Array.isArray(entry.affectedTiers) ||
        typeof observed.environment.tier !== "string" ||
        !observed.environment.tier ||
        !entry.affectedTiers.includes(observed.environment.tier)) {
      return false;
    }
  }
  return true;
}

function validIdentity(identity) {
  return isRecord(identity) &&
    ["suite", "test", "failureSignature"].every((key) =>
      typeof identity[key] === "string" && identity[key].length > 0,
    ) &&
    isRecord(identity.environment);
}

function validDate(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function uniqueStrings(values, label) {
  if (!Array.isArray(values) || values.some((value) =>
    typeof value !== "string" || value.length === 0,
  ) || new Set(values).size !== values.length) {
    return { ok: false, reason: `${label} must contain unique non-empty IDs` };
  }
  return { ok: true };
}

function asCatalogEntries(entries) {
  if (!Array.isArray(entries)) return null;
  const ids = entries.map((entry) => entry?.id);
  if (entries.some((entry) => !isRecord(entry) || typeof entry.id !== "string" || !entry.id) ||
      new Set(ids).size !== ids.length) return null;
  return entries;
}

function eligibleActiveBaseline(entry, nowDate) {
  return entry.status === "active" &&
    entry.evidence?.authoritative === true &&
    validDate(entry.reviewDeadline) &&
    nowDate <= entry.reviewDeadline;
}

function hasStoredRecordReference(evidence) {
  return typeof evidence?.recordReference === "string" &&
    evidence.recordReference.trim().length > 0;
}

function verifiedRepairProof(proof, observed) {
  return isRecord(proof) &&
    hasStoredRecordReference(proof) &&
    proof.verified === true &&
    proof.trustworthyResult === true &&
    proof.trustworthyDiscovery === true &&
    proof.discovered === true &&
    proof.outcome === "pass" &&
    exactIdentity(observed, proof);
}

function retrySetAssessment(retries, observed) {
  if (!Array.isArray(retries) || retries.length !== 3) {
    return { ok: false, reason: "exactly three isolation retries are required" };
  }
  const retryIds = retries.map((retry) => retry?.retryId);
  if (retryIds.some((id) => typeof id !== "string" || id.length === 0) ||
      new Set(retryIds).size !== 3) {
    return { ok: false, reason: "isolation retries must have three distinct retry IDs" };
  }
  for (const retry of retries) {
    if (!isRecord(retry) ||
        !hasStoredRecordReference(retry) ||
        retry.authorized !== true ||
        retry.safeIsolation !== true ||
        retry.trustworthyResult !== true ||
        retry.trustworthyDiscovery !== true ||
        retry.discovered !== true ||
        !exactIdentity(observed, retry) ||
        !["pass", "fail"].includes(retry.outcome)) {
      return { ok: false, reason: "each retry needs authorized safe isolation and trustworthy matching result/discovery" };
    }
    if (retry.outcome === "fail" && retry.failureSignature !== observed.failureSignature) {
      return { ok: false, reason: "retry failure signature differs from the observed failure" };
    }
  }
  return {
    ok: true,
    intermittent: retries.some((retry) => retry.outcome === "pass"),
    reproduced: retries.some((retry) => retry.outcome === "fail"),
  };
}

function verifiedPreTaskFailure(evidence, observed) {
  return isRecord(evidence) &&
    hasStoredRecordReference(evidence) &&
    evidence.verified === true &&
    evidence.trustworthyResult === true &&
    evidence.trustworthyDiscovery === true &&
    evidence.discovered === true &&
    evidence.outcome === "fail" &&
    typeof evidence.sourceId === "string" &&
    evidence.sourceId.length > 0 &&
    exactIdentity(observed, evidence);
}

function independentCorroboration(evidence, observed, preTaskEvidence) {
  return isRecord(evidence) &&
    hasStoredRecordReference(evidence) &&
    evidence.verified === true &&
    evidence.trustworthyResult === true &&
    evidence.trustworthyDiscovery === true &&
    evidence.discovered === true &&
    evidence.outcome === "fail" &&
    exactIdentity(observed, evidence) &&
    typeof evidence.sourceId === "string" &&
    evidence.sourceId.length > 0 &&
    evidence.sourceId !== preTaskEvidence.sourceId;
}

/**
 * Classify one exact observed failure without changing or promoting the catalog.
 *
 * Required input:
 * - observed: { suite, test, failureSignature, environment }
 * - catalogEntries: the catalog snapshot being evaluated
 * - ignoredBaselineIds / ownedBaselineIds: IDs explicitly declared for this task
 * - now: an ISO UTC date (YYYY-MM-DD), used for reviewDeadline expiry
 *
 * Unlisted failures additionally need retries (exactly three authorized, safe,
 * distinct runs), preTaskEvidence, and corroboration. A successful return with
 * PREEXISTING is task-local accounting evidence only; it never creates a baseline.
 *
 * Evidence records must include recordReference and the verification/result/
 * discovery fields consumed below, populated by the integration from trusted
 * stored diagnostic records. This module cannot authenticate arbitrary input:
 * caller-supplied verified:true (or a fabricated recordReference) is not proof.
 * Integrators must resolve and validate recordReference against their trusted
 * coordinator/storage and must never project these fields from caller claims.
 */
export function classifyFailure({
  observed,
  catalogEntries,
  ignoredBaselineIds = [],
  ownedBaselineIds = [],
  now,
  retries,
  preTaskEvidence,
  corroboration,
  repairProof,
} = {}) {
  const blocked = (reason) => ({
    outcome: OUTCOMES.BLOCKED,
    accepted: false,
    intermittent: false,
    baselineId: null,
    reason,
  });

  if (!validIdentity(observed)) {
    return blocked("observed failure requires exact suite, test, signature, and environment identity");
  }
  const entries = asCatalogEntries(catalogEntries);
  if (!entries) return blocked("catalog entries are missing, malformed, or have duplicate IDs");
  if (!validDate(now)) return blocked("classification requires a valid authoritative date");

  const ignoredCheck = uniqueStrings(ignoredBaselineIds, "ignored baseline IDs");
  if (!ignoredCheck.ok) return blocked(ignoredCheck.reason);
  const ownedCheck = uniqueStrings(ownedBaselineIds, "owned baseline IDs");
  if (!ownedCheck.ok) return blocked(ownedCheck.reason);
  const ignored = new Set(ignoredBaselineIds);
  const owned = new Set(ownedBaselineIds);
  if ([...owned].some((id) => ignored.has(id))) {
    return blocked("a baseline ID cannot be both ignored and owned");
  }
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const missingId = [...ignored, ...owned].find((id) => !byId.has(id));
  if (missingId) return blocked(`declared baseline ID '${missingId}' is absent from the catalog`);

  // Ownership is a repair obligation rather than an ignore permission. It stays
  // live after expiry, but only for the exact recorded failure identity.
  const ownedMatch = ownedBaselineIds.find((id) => baselineMatches(byId.get(id), observed));
  if (ownedMatch) {
    const proven = verifiedRepairProof(repairProof, observed);
    return {
      outcome: proven ? OUTCOMES.OWNED_PROVEN : OUTCOMES.OWNED_REQUIRED,
      accepted: proven,
      intermittent: false,
      baselineId: ownedMatch,
      reason: proven
        ? "owned failure has verified discovered passing repair proof"
        : "owned repair obligation remains; expiry or reclassification cannot waive it",
    };
  }
  if (ownedBaselineIds.length > 0) {
    return blocked("declared owned baseline does not exactly match this failure");
  }

  const matches = ignoredBaselineIds
    .map((id) => byId.get(id))
    .filter((entry) => baselineMatches(entry, observed));
  if (matches.length > 1) return blocked("failure ambiguously matches multiple declared baselines");
  if (matches.length === 1) {
    const [entry] = matches;
    if (!eligibleActiveBaseline(entry, now)) {
      return blocked(`baseline '${entry.id}' is not authoritative, active, and unexpired`);
    }
    return {
      outcome: OUTCOMES.IGNORED,
      accepted: true,
      intermittent: false,
      baselineId: entry.id,
      reason: "exact failure matches a declared authoritative active unexpired baseline",
    };
  }
  if (ignoredBaselineIds.length > 0) {
    return blocked("declared ignored baseline does not exactly match this failure");
  }

  const retryAssessment = retrySetAssessment(retries, observed);
  if (!retryAssessment.ok) return blocked(retryAssessment.reason);
  const preTaskVerified = verifiedPreTaskFailure(preTaskEvidence, observed);
  if (!preTaskVerified) {
    return {
      ...blocked("unlisted failure lacks a verified matching failure on the pre-task snapshot"),
      intermittent: retryAssessment.intermittent,
    };
  }
  if (!independentCorroboration(corroboration, observed, preTaskEvidence)) {
    return {
      ...blocked("unlisted failure lacks independent matching corroboration"),
      intermittent: retryAssessment.intermittent,
    };
  }
  return {
    outcome: OUTCOMES.PREEXISTING,
    accepted: true,
    intermittent: retryAssessment.intermittent,
    baselineId: null,
    reason: retryAssessment.intermittent
      ? "verified pre-task failure is independently corroborated; passing retries establish intermittency only"
      : "failure reproduced by authorized isolation retries and independently corroborated on the pre-task snapshot",
  };
}

export const FAILURE_CLASSIFICATION = OUTCOMES;