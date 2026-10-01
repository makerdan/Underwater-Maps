import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { canonicalJson, digestJson } from "./canonical.mjs";
import { getRegisteredValidationPolicy } from "./policy.mjs";
import { prepareAcceptedProjectTask } from "./replit-task.mjs";

export const BOOTSTRAP_APPROVAL_REFERENCE = ".agents/failure-gate-v4/bootstrap-approval.json";

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 512 * 1024,
  }).trimEnd();
}

/**
 * A pinned conversation decision permits only its installation demonstration.
 * The file records an actual approval captured by Agent; Git pins the bytes,
 * not the identity of a person or the authenticity of the conversation.
 * No ordinary-task cutover flag or caller-supplied decision is accepted here.
 */
export function verifyBootstrapApproval({ projectRoot, projectTask, projectNamespace }) {
  const root = realpathSync(resolve(projectRoot));
  const source = prepareAcceptedProjectTask(projectTask);
  const path = resolve(root, BOOTSTRAP_APPROVAL_REFERENCE);
  let revision;
  let content;
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() ||
        realpathSync(path) !== path || !path.startsWith(`${root}${sep}`)) {
      throw new Error("bootstrap decision must be a regular project-root file");
    }
    revision = git(root, ["rev-parse", "HEAD"]);
    content = git(root, ["show", `${revision}:${BOOTSTRAP_APPROVAL_REFERENCE}`]);
    if (readFileSync(path, "utf8").trimEnd() !== content) {
      throw new Error("working bootstrap decision differs from the pinned committed source");
    }
  } catch (error) {
    throw new Error(`ordinary v4 activation is blocked; current pinned bootstrap approval unavailable: ${error.message}`);
  }
  const decision = JSON.parse(content);
  const keys = [
    "format", "decision", "source", "approvedAt", "projectNamespace",
    "taskRef", "title", "descriptionDigest", "tier", "parameters",
    "policySnapshotDigest", "ordinaryActivation",
  ];
  if (Object.keys(decision).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(decision, key)) ||
      decision.format !== "failure-gate-v4-bootstrap-approval-v1" ||
      decision.decision !== "approved-installation-bootstrap" ||
      decision.source !== "explicit-conversation-approval" ||
      decision.ordinaryActivation !== false ||
      decision.projectNamespace !== projectNamespace ||
      decision.taskRef !== source.snapshot.taskRef ||
      decision.title !== source.snapshot.title ||
      decision.descriptionDigest !== source.descriptionDigest ||
      decision.tier !== source.tier ||
      decision.tier !== "test-heavy" ||
      canonicalJson(decision.parameters) !== "{}" ||
      typeof decision.approvedAt !== "string" ||
      !Number.isFinite(Date.parse(decision.approvedAt)) ||
      new Date(decision.approvedAt).toISOString() !== decision.approvedAt) {
    throw new Error("pinned bootstrap decision does not approve this exact installation plan and tier");
  }
  const policy = getRegisteredValidationPolicy(root);
  if (decision.policySnapshotDigest !== policy.snapshotDigest) {
    throw new Error("governing policy changed; a renewed separate bootstrap approval is required");
  }
  return Object.freeze({
    reference: BOOTSTRAP_APPROVAL_REFERENCE,
    revision,
    sourceDigest: digestJson(decision),
    policySnapshotDigest: policy.snapshotDigest,
    taskRef: source.snapshot.taskRef,
    approvedAt: decision.approvedAt,
    ordinaryActivation: false,
  });
}