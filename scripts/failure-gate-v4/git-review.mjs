import { execFileSync } from "node:child_process";
import { canonicalJson, digestJson } from "./canonical.mjs";

const LOCAL_TASK_ID = /^TASK-\d{6,}$/;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const REVIEWER_ROSTER_PATH = ".agents/failure-gate-v4/reviewers.json";

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024,
  }).trimEnd();
}

function readCommittedJson(root, revision, filePath, label) {
  const treeEntry = git(root, ["ls-tree", "-z", revision, "--", filePath]).split("\0")[0];
  const [metadata, entryPath] = treeEntry.split("\t");
  const [mode, type] = (metadata ?? "").split(" ");
  if (entryPath !== filePath || type !== "blob" || !["100644", "100755"].includes(mode)) {
    throw new Error(`pinned reviewer snapshot is missing a regular ${label} blob at '${filePath}'`);
  }
  const text = git(root, ["show", `${revision}:${filePath}`]);
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected JSON object");
    return value;
  } catch (error) {
    throw new Error(`invalid ${label} JSON in pinned reviewer snapshot: ${error.message}`);
  }
}

export function loadPinnedReviewerDecision(options) {
  if (Object.hasOwn(options ?? {}, "rosterPath") || Object.hasOwn(options ?? {}, "decisionPath")) {
    throw new Error("alternate reviewer source paths are not permitted");
  }
  const { projectRoot, revision, task, taskAgent, validationPolicy } = options ?? {};
  if (!task || !LOCAL_TASK_ID.test(task.taskId ?? "")) throw new TypeError("a valid local task record is required");
  if (typeof taskAgent !== "string" || taskAgent.trim() === "") throw new TypeError("taskAgent must identify the task agent");
  const taskAgentIdentity = taskAgent.trim();
  if (!validationPolicy || !validationPolicy.tiers?.[task.requestedTier]) {
    throw new Error("activation blocked: installed tier policy is unavailable");
  }
  const rosterFile = REVIEWER_ROSTER_PATH;
  const decisionFile = `.agents/failure-gate-v4/decisions/${task.taskId}.json`;

  let sourceRevision;
  try {
    sourceRevision = git(projectRoot, ["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`]);
  } catch {
    throw new Error("activation blocked: reviewer source revision is not a resolvable Git commit");
  }
  if (!OBJECT_ID.test(sourceRevision)) throw new Error("activation blocked: Git returned an invalid pinned commit ID");

  const roster = readCommittedJson(projectRoot, sourceRevision, rosterFile, "reviewer roster");
  const decision = readCommittedJson(projectRoot, sourceRevision, decisionFile, "reviewer decision");
  if (!Array.isArray(roster.reviewers)) throw new Error("activation blocked: pinned reviewer roster has no reviewers list");
  if (decision.decision !== "approved") throw new Error("activation blocked: pinned reviewer decision is absent or not approved");
  if (!["admin", "Dan"].includes(decision.reviewerId)) {
    throw new Error("activation blocked: reviewer must be admin or Dan");
  }
  if (decision.reviewerId === taskAgentIdentity) throw new Error("activation blocked: task agent cannot review its own task");
  const reviewerEntry = roster.reviewers.find((entry) =>
    entry && entry.id === decision.reviewerId && entry.active === true,
  );
  if (!reviewerEntry) throw new Error("activation blocked: reviewer is not active in the pinned roster");
  if (typeof decision.reference !== "string" || decision.reference.trim() === "") {
    throw new Error("activation blocked: reviewer decision has no real review reference");
  }

  const expected = {
    taskId: task.taskId,
    projectNamespace: task.projectNamespace,
    planVersion: task.planVersion,
    planDigest: task.planDigest,
    tier: task.requestedTier,
    tierDefinitionDigest: task.tierDefinitionDigest,
    registeredTiers: validationPolicy.registeredTiers,
    registeredTiersDigest: digestJson(validationPolicy.registeredTiers),
    registryDigest: validationPolicy.registryDigest,
    wrapperDigest: validationPolicy.wrapperDigest,
    policySnapshotDigest: validationPolicy.snapshotDigest,
    parametersDigest: task.parametersDigest,
    policyVersion: task.policyVersion,
    authorizationVersion: task.authorizationVersion + 1,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (Array.isArray(value)
      ? canonicalJson(decision[key]) !== canonicalJson(value)
      : decision[key] !== value) {
      throw new Error(`activation blocked: committed reviewer decision does not match ${key}`);
    }
  }

  // Pin the permitted use with the decision, not with caller arguments. The
  // ordinary route cannot be enabled until a separately reviewed cutover has
  // demonstrated complete evidence and effective final-write coordination.
  if (decision.activationScope !== "installation-demonstration") {
    throw new Error("ordinary v4 activation is blocked: a pinned installation-demonstration decision is required until reviewed cutover");
  }

  const approval = {
    ...expected,
    activationScope: decision.activationScope,
    decision: "approved",
    sourceKind: "git-review",
    reviewerId: decision.reviewerId,
    reference: decision.reference.trim(),
    sourceRevision,
    reviewerRosterDigest: digestJson(roster),
    decisionContentDigest: digestJson(decision),
    sourceDigest: digestJson({
      sourceRevision,
      reviewerRosterDigest: digestJson(roster),
      decisionContentDigest: digestJson(decision),
    }),
  };
  return Object.freeze({
    approval: Object.freeze(approval),
    sourceRevision,
    reviewerRosterDigest: digestJson(roster),
    decisionContentDigest: digestJson(decision),
    identityAttestation: false,
  });
}