import {
  lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve, sep } from "node:path";
import { canonicalJson, digestJson, sha256 } from "./canonical.mjs";

export const REPLIT_TASK_POLICY_ID = "replit-accepted-plan-single-tier-v1";
export const REPLIT_TASK_ACCEPTED_STATE = "IN_PROGRESS";
const MAX_DESCRIPTION_BYTES = 256 * 1024;

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function validTimestamp(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${label} must be a valid platform timestamp`);
  }
  try {
    if (new Date(value).toISOString() !== value) {
      throw new Error("non-canonical timestamp");
    }
  } catch {
    throw new TypeError(`${label} must be a canonical ISO timestamp`);
  }
  return value;
}

function section(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const index = lines.findIndex((line) => line.trimEnd() === `## ${heading}`);
  if (index < 0) throw new Error(`accepted project task is missing its ## ${heading} section`);
  const body = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (lines[cursor].startsWith("## ")) break;
    body.push(lines[cursor]);
  }
  return body.join("\n");
}

function requiredField(body, expression, label) {
  const value = body.match(expression)?.[1]?.trim();
  if (!value) throw new Error(`accepted project task is missing ${label}`);
  return value;
}

export function normalizeAcceptedProjectTask(task) {
  if (!task || typeof task !== "object" || Array.isArray(task)) {
    throw new TypeError("a project-task callback result is required");
  }
  const taskRef = requiredText(task.taskRef, "project task reference");
  if (!/^#\d+$/.test(taskRef)) throw new TypeError("project task reference is malformed");
  const title = requiredText(task.title, "project task title");
  const description = requiredText(task.description, "project task description");
  if (Buffer.byteLength(description, "utf8") > MAX_DESCRIPTION_BYTES) {
    throw new Error("project task description exceeds the bounded source size");
  }
  if (task.state !== REPLIT_TASK_ACCEPTED_STATE) {
    throw new Error(`project task is not accepted and active (expected ${REPLIT_TASK_ACCEPTED_STATE})`);
  }
  return Object.freeze({
    taskRef,
    title,
    description,
    state: task.state,
    createdAt: validTimestamp(task.createdAt, "project task createdAt"),
    updatedAt: validTimestamp(task.updatedAt, "project task updatedAt"),
  });
}

export function projectTaskDescriptionDigest(description) {
  return sha256(Buffer.from(requiredText(description, "project task description"), "utf8"));
}

export function prepareAcceptedProjectTask(task) {
  const snapshot = normalizeAcceptedProjectTask(task);
  const descriptionDigest = projectTaskDescriptionDigest(snapshot.description);
  const validationSection = section(snapshot.description, "Validation");
  const tier = requiredField(validationSection, /^\s*\*\*Command:\*\*\s+`([^`]+)`\s*$/m, "a registered validation command");
  const why = requiredField(validationSection, /^\s*\*\*Why:\*\*\s*(.+?)\s*$/m, "a validation rationale");
  const doNotEscalate = requiredField(
    validationSection,
    /^\s*\*\*Do not escalate:\*\*\s*(.+?)\s*$/m,
    "a no-escalation rule",
  );
  const guardSection = section(snapshot.description, "Regression Guard");
  const regressionGuard = {
    covers: requiredField(guardSection, /^\s*\*\*Covers:\*\*\s*(.+?)\s*$/m, "Regression Guard Covers"),
    testLocation: requiredField(guardSection, /^\s*\*\*Test location:\*\*\s*`?([^`\n]+?)`?\s*$/m, "Regression Guard Test location"),
    whatItChecks: requiredField(guardSection, /^\s*\*\*What it checks:\*\*\s*(.+?)\s*$/m, "Regression Guard What it checks"),
  };
  if (/\bBASE-[A-Z0-9-]+\b/.test(snapshot.description)) {
    throw new Error("project-task import requires explicit local baseline references; baseline IDs are not inferred from prose");
  }

  const safeRef = snapshot.taskRef.slice(1);
  const projectionDigest = digestJson({
    taskRef: snapshot.taskRef,
    title: snapshot.title,
    descriptionDigest,
    policyId: REPLIT_TASK_POLICY_ID,
  });
  const sourceStem = `replit-${safeRef}-${projectionDigest.slice(0, 16)}`;
  const sourceMarkdownReference = `docs/validation/failure-gate-v4/task-plans/${sourceStem}.md`;
  const planReference = `docs/validation/failure-gate-v4/task-plans/${sourceStem}.json`;
  const plan = {
    title: snapshot.title,
    projectTaskSource: {
      provider: "replit-project-tasks",
      taskRef: snapshot.taskRef,
      title: snapshot.title,
      descriptionDigest,
      policyId: REPLIT_TASK_POLICY_ID,
    },
    validation: {
      tier,
      why,
      maximumTier: tier,
      noEscalation: true,
      doNotEscalate,
    },
    baselines: { ignore: [], owned: [] },
    regressionGuard,
    legacyPlan: {
      reference: sourceMarkdownReference,
      sha256: descriptionDigest,
    },
  };
  return Object.freeze({
    snapshot,
    sourceDigest: digestJson(snapshot),
    descriptionDigest,
    tier,
    planReference,
    sourceMarkdownReference,
    plan,
  });
}

function ensureProjectFile(root, relativePath, expectedContent) {
  const absolutePath = resolve(root, relativePath);
  if (!absolutePath.startsWith(`${root}${sep}`)) {
    throw new Error("project-task projection escapes the project root");
  }
  mkdirSync(dirname(absolutePath), { recursive: true });
  try {
    const info = lstatSync(absolutePath);
    if (!info.isFile() || info.isSymbolicLink() || realpathSync(absolutePath) !== absolutePath) {
      throw new Error(`project-task projection is not a regular file: ${relativePath}`);
    }
    if (readFileSync(absolutePath, "utf8") !== expectedContent) {
      throw new Error(`project-task projection already exists with different content: ${relativePath}`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    writeFileSync(absolutePath, expectedContent, { flag: "wx", mode: 0o644 });
  }
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}

export function persistAcceptedProjectTaskProjection({ projectRoot, task, snapshot }) {
  const root = realpathSync(resolve(projectRoot));
  const normalized = normalizeAcceptedProjectTask(snapshot);
  const source = task.plan.projectTaskSource;
  if (!source || source.provider !== "replit-project-tasks" ||
      source.taskRef !== normalized.taskRef ||
      source.title !== normalized.title ||
      source.descriptionDigest !== projectTaskDescriptionDigest(normalized.description) ||
      source.policyId !== REPLIT_TASK_POLICY_ID) {
    throw new Error("accepted project-task snapshot does not match the reserved local plan binding");
  }
  const planContent = `${canonicalJson(task.plan)}\n`;
  ensureProjectFile(root, task.planReference, planContent);
  ensureProjectFile(root, task.plan.legacyPlan.reference, normalized.description);
  git(root, ["add", "--", task.planReference, task.plan.legacyPlan.reference]);
  for (const reference of [task.planReference, task.plan.legacyPlan.reference]) {
    if (git(root, ["ls-files", "--error-unmatch", "--", reference]) !== reference) {
      throw new Error(`project-task projection was not registered as tracked: ${reference}`);
    }
  }
  return Object.freeze({
    planReference: task.planReference,
    sourceReference: task.plan.legacyPlan.reference,
    sourceDigest: digestJson(normalized),
  });
}

export function verifyAcceptedProjectTaskBinding({ projectRoot, task, projectTask }) {
  const snapshot = normalizeAcceptedProjectTask(projectTask);
  const source = task?.plan?.projectTaskSource;
  if (!source || source.provider !== "replit-project-tasks" ||
      source.policyId !== REPLIT_TASK_POLICY_ID ||
      snapshot.taskRef !== source.taskRef ||
      snapshot.title !== source.title ||
      projectTaskDescriptionDigest(snapshot.description) !== source.descriptionDigest ||
      task.plan.validation?.tier !== task.requestedTier) {
    throw new Error("current accepted project task does not match the exact reserved local plan and tier");
  }
  const markdownPath = resolve(projectRoot, task.plan.legacyPlan?.reference ?? "");
  const root = realpathSync(resolve(projectRoot));
  if (!markdownPath.startsWith(`${root}${sep}`) || realpathSync(markdownPath) !== markdownPath) {
    throw new Error("bound project-task plan projection is not a safe project-root file");
  }
  const markdown = readFileSync(markdownPath);
  if (sha256(markdown) !== source.descriptionDigest ||
      markdown.toString("utf8") !== snapshot.description) {
    throw new Error("tracked project-task plan projection differs from the current platform description");
  }
  const expected = prepareAcceptedProjectTask(snapshot);
  if (expected.tier !== task.requestedTier ||
      canonicalJson({
        validation: task.plan.validation,
        baselines: task.plan.baselines,
        regressionGuard: task.plan.regressionGuard,
        legacyPlan: task.plan.legacyPlan,
      }) !== canonicalJson({
        validation: expected.plan.validation,
        baselines: expected.plan.baselines,
        regressionGuard: expected.plan.regressionGuard,
        legacyPlan: expected.plan.legacyPlan,
      })) {
    throw new Error("reserved plan guards no longer match the exact accepted project-task description");
  }
  return Object.freeze({
    snapshot,
    sourceDigest: digestJson(snapshot),
    descriptionDigest: source.descriptionDigest,
    policyId: source.policyId,
  });
}