import { resolve } from "node:path";
import { FailureGateCoordinator } from "./coordinator.mjs";
import { FailureGateCheckedRunner } from "./runner.mjs";

const PROJECT_NAMESPACE = "bathyscan-failure-gate-v4";
const MAX_INPUT_BYTES = 512 * 1024;

async function readInput() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) throw new Error("Agent bridge input exceeds the bounded source size");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function summary(task) {
  return {
    taskId: task.taskId,
    status: task.status,
    requestedTier: task.requestedTier,
    authorizedTier: task.authorizedTier,
    planVersion: task.planVersion,
    planDigest: task.planDigest,
    policyVersion: task.policyVersion,
    approvalSourceKind: task.approvalSourceKind,
    approvalSourceDigest: task.approvalSourceDigest,
    planReference: task.planReference,
  };
}

async function main() {
  const payload = await readInput();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Agent bridge input must be a JSON object");
  }
  const projectRoot = resolve(import.meta.dirname, "../..");
  const coordinator = new FailureGateCoordinator({
    projectRoot,
    projectNamespace: PROJECT_NAMESPACE,
  });
  try {
    if (payload.action === "reserve-plan" || payload.action === "capture-activate") {
      if (Object.keys(payload).some((key) => !["action", "projectTask"].includes(key))) {
        throw new Error("plan capture accepts only the Agent-side project-task callback result");
      }
      const reserved = await coordinator.reserveAcceptedProjectTask(payload.projectTask);
      const active = payload.action === "capture-activate" && reserved.status === "draft"
        ? await coordinator.activateAcceptedProjectTask({
            taskId: reserved.taskId,
            projectTask: payload.projectTask,
          })
        : reserved;
      process.stdout.write(`${JSON.stringify(summary(active))}\n`);
      return;
    }
    if (payload.action === "run-required") {
      if (Object.keys(payload).some((key) => !["action", "taskId", "projectTask"].includes(key))) {
        throw new Error("run-required accepts only a local task ID and a fresh Agent-side project-task callback result");
      }
      const task = coordinator.store.getTask(payload.taskId);
      if (!task) throw new Error(`unknown local task '${payload.taskId}'`);
      const runner = new FailureGateCheckedRunner({ store: coordinator.store });
      const result = await runner.runRequiredValidation({
        taskId: task.taskId,
        planReference: task.planReference,
        projectTask: payload.projectTask,
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }
    if (payload.action === "assess-local") {
      if (Object.keys(payload).some((key) =>
        !["action", "taskId", "attemptId"].includes(key))) {
        throw new Error("assessment accepts only retained local task/run identity");
      }
      const assessment = coordinator.store.assessRunAttempt({
        taskId: payload.taskId, attemptId: payload.attemptId,
      });
      process.stdout.write(`${JSON.stringify(assessment)}\n`);
      return;
    }
    if (["classify-stored", "repair-stored", "isolate-stored"].includes(payload.action)) {
      const { action, ...request } = payload;
      const result = action === "classify-stored"
        ? coordinator.classifyStoredFailure(request)
        : action === "repair-stored"
          ? coordinator.assessOwnedRepairs(request)
          : await coordinator.runStoredIsolationRetry(request);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }
    if (payload.action === "complete-local") {
      if (Object.keys(payload).some((key) =>
        !["action", "taskId", "attemptId", "projectTask"].includes(key))) {
        throw new Error("local completion accepts only task/run identity and a fresh source snapshot");
      }
      const task = coordinator.store.getTask(payload.taskId);
      const attempt = coordinator.store.getValidationAttempt(payload.attemptId);
      if (!task || !attempt || attempt.taskId !== task.taskId) {
        throw new Error("local completion requires a run belonging to this local task");
      }
      const completed = await coordinator.completeTask({
        taskId: task.taskId, attemptId: attempt.attemptId,
        projectTask: payload.projectTask,
        expectedAuthorizationVersion: task.authorizationVersion,
        authorizationDigest: attempt.authorizationDigest,
        inputDigest: attempt.inputDigest,
      });
      process.stdout.write(`${JSON.stringify(summary(completed))}\n`);
      return;
    }
    if (payload.action === "reconcile-orphan") {
      if (Object.keys(payload).some((key) =>
        !["action", "attemptId", "resolution", "reason"].includes(key))) {
        throw new Error("orphan recovery does not accept caller stopped-process assertions");
      }
      const result = await coordinator.reconcileOrphanedRunAttempt({
        attemptId: payload.attemptId, resolution: payload.resolution, reason: payload.reason,
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }
    if (payload.action === "cancel-local") {
      if (Object.keys(payload).some((key) =>
        !["action", "taskId", "reason"].includes(key))) {
        throw new Error("local cancellation accepts only task identity and a reason");
      }
      const task = coordinator.store.getTask(payload.taskId);
      if (!task) throw new Error("unknown local cancellation task");
      const cancelled = coordinator.terminateTask({
        taskId: task.taskId, status: "cancelled",
        expectedAuthorizationVersion: task.authorizationVersion, reason: payload.reason,
      });
      process.stdout.write(`${JSON.stringify(summary(cancelled))}\n`);
      return;
    }
    throw new Error("unsupported Agent bridge action");
  } finally {
    coordinator.close();
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}