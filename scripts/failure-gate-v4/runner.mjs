import { lstat, readFile, realpath } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalJson, digestJson } from "./canonical.mjs";
import { getRegisteredValidationPolicy } from "./policy.mjs";
import { captureWorkspaceSnapshot } from "./snapshot.mjs";

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}

function resolvePlanPath(projectRoot, reference) {
  if (typeof reference !== "string" || reference.trim() === "" || isAbsolute(reference) ||
      reference.includes("\\") || reference.split("/").some((part) => part === "" || part === "." || part === "..") ||
      /[\u0000-\u001f\u007f]/.test(reference)) {
    throw new Error("approved plan reference must be a safe project-relative path");
  }
  const root = resolve(projectRoot);
  const planPath = resolve(root, reference);
  if (!planPath.startsWith(`${root}${sep}`)) throw new Error("approved plan reference escapes the project root");
  return planPath;
}

export async function verifyApprovedPlanProjection({ projectRoot, task, suppliedPlanReference }) {
  if (suppliedPlanReference !== undefined && suppliedPlanReference !== task.planReference) {
    throw new Error("supplied plan reference does not match the task's exact approved plan reference");
  }
  const root = await realpath(resolve(projectRoot));
  const planPath = resolvePlanPath(root, task.planReference);
  const info = await lstat(planPath);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("approved plan projection must be a regular tracked file");
  }
  const actualPath = await realpath(planPath);
  if (actualPath !== planPath || !actualPath.startsWith(`${root}${sep}`)) {
    throw new Error("approved plan projection resolves outside its project root");
  }

  let trackedPath;
  try {
    trackedPath = git(root, ["ls-files", "--error-unmatch", "--", task.planReference]);
  } catch {
    throw new Error("approved plan projection is not a tracked project-root file");
  }
  if (trackedPath !== task.planReference) throw new Error("tracked plan path did not resolve exactly");
  const content = await readFile(planPath, "utf8");
  const canonicalPlan = canonicalJson(task.plan);
  if (content !== canonicalPlan && content !== `${canonicalPlan}\n`) {
    throw new Error("tracked plan projection content differs from the exact approved canonical plan");
  }
  const projection = JSON.parse(content);
  if (projection.taskId !== task.taskId || projection.projectNamespace !== task.projectNamespace ||
      projection.planVersion !== task.planVersion || digestJson(projection) !== task.planDigest) {
    throw new Error("tracked plan identity, version, namespace, or digest does not match this local task");
  }
  return Object.freeze({
    reference: task.planReference,
    absolutePath: planPath,
    planVersion: task.planVersion,
    planDigest: task.planDigest,
  });
}

export class FailureGateCheckedRunner {
  constructor({ store }) {
    if (!store || typeof store.getTask !== "function" ||
        typeof store.recordBlockedRunAttempt !== "function") {
      throw new TypeError("FailureGateCheckedRunner requires a FailureGateStore");
    }
    this.store = store;
    this.projectRoot = resolve(store.projectRoot);
  }

  async requestRequiredValidation({ taskId, planReference } = {}) {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`unknown local Failure Gate task '${taskId}'`);
    if (task.status !== "active" || task.suspended || !task.authorizedTier) {
      throw new Error("required-tier execution requires an active, unsuspended local task");
    }
    const authorizationVersion = task.authorizationVersion;
    const projection = await verifyApprovedPlanProjection({
      projectRoot: this.projectRoot,
      task,
      suppliedPlanReference: planReference,
    });

    let tierPolicy;
    let validationPolicy;
    try {
      validationPolicy = getRegisteredValidationPolicy(this.projectRoot);
      tierPolicy = validationPolicy.tiers[task.authorizedTier];
      if (!tierPolicy) throw new Error("authorized tier is absent from the installed validation policy");
    } catch (error) {
      throw new Error(`required-tier policy is unavailable; execution denied: ${error.message}`);
    }
    if (tierPolicy.tierDefinitionDigest !== task.tierDefinitionDigest) {
      throw new Error("current registered tier, command, steps, or wrappers differ from the approved tier-definition digest");
    }
    if (task.registryVersion !== tierPolicy.registryDigest) {
      throw new Error("current validation registry digest differs from the activation registry version");
    }
    if (task.registryDigest !== tierPolicy.registryDigest ||
        task.wrapperDigest !== tierPolicy.wrapperDigest ||
        task.policySnapshotDigest !== validationPolicy.snapshotDigest ||
        canonicalJson(task.registeredTiers) !== canonicalJson(validationPolicy.registeredTiers)) {
      throw new Error("current registered tier list, registry, wrapper, or policy snapshot differs from activation");
    }

    const snapshot = await captureWorkspaceSnapshot(this.projectRoot);
    const reasons = [];
    if (!tierPolicy.reportAdapterKnown || !tierPolicy.reportAdapterId) {
      reasons.push("required_report_adapter_missing");
    } else {
      reasons.push("no_checked_executor_is_registered_for_the_report_adapter");
    }
    if (snapshot.manifest.integrity !== "observed-only") {
      reasons.push("snapshot_integrity_unknown");
    }
    reasons.push("writer_coordination_adapter_unavailable");

    // The existing tier commands stream human-oriented logs and do not expose
    // a complete machine report contract. No tier is launched until a versioned
    // parser can account for every step, raw result, and report artifact.
    const attempt = this.store.recordBlockedRunAttempt({
      taskId: task.taskId,
      expectedAuthorizationVersion: authorizationVersion,
      tier: task.authorizedTier,
      tierDefinitionDigest: tierPolicy.tierDefinitionDigest,
      registryDigest: tierPolicy.registryDigest,
      wrapperDigest: tierPolicy.wrapperDigest,
      reportAdapterId: tierPolicy.reportAdapterId,
      stepNames: tierPolicy.selectedStepNames,
      snapshot,
      reasons,
    });
    return Object.freeze({
      taskId: task.taskId,
      attemptId: attempt.attemptId,
      purpose: attempt.purpose,
      status: "BLOCKED",
      commandLaunched: false,
      leaseAcquired: false,
      plan: projection,
      tier: task.authorizedTier,
      rawExitStatus: null,
      reportAdapterId: tierPolicy.reportAdapterId,
      snapshotDigest: attempt.snapshotDigest,
      snapshotIntegrity: attempt.snapshot.integrity,
      reasons: attempt.blockedReasons,
      stepResults: attempt.stepResults,
    });
  }
}