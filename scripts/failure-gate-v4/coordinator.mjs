import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { digestJson } from "./canonical.mjs";
import {
  capturePlanningBaseline,
  loadTrackedBaselineCatalog,
  validatePlanningGuards,
} from "./planning.mjs";
import { FailureGateStore } from "./store.mjs";
import { getRegisteredValidationPolicy } from "./policy.mjs";
import { captureWorkspaceSnapshot } from "./snapshot.mjs";
import { withWriterLock } from "./writer-lock.mjs";
import {
  normalizeAcceptedProjectTask,
  persistAcceptedProjectTaskProjection,
  verifyAcceptedProjectTaskBinding,
} from "./replit-task.mjs";
import { assertRecordedRunStopped } from "./recovery.mjs";
import { withRunEnvironment, withAcceptedTaskSource } from "./run-context.mjs";
import { FailureGateDiagnostics } from "./diagnostics.mjs";

export class FailureGateCoordinator {
  constructor(options) {
    this.store = options.store ?? new FailureGateStore(options);
    this.ownsStore = !options.store;
    this.processIdentity = `pid:${process.pid}:${randomUUID()}`;
  }

  async reserveTask(input) {
    const task = this.store.reserveTask(input);
    if (task.status === "draft") await this.capturePlanningBaseline(task.taskId);
    return task;
  }

  async capturePlanningBaseline(taskId) {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`unknown local task '${taskId}'`);
    const existing = this.store.getPlanningBaseline(task.taskId);
    if (existing) return existing;
    if (task.status !== "draft") {
      throw new Error("planning baseline capture requires a reserved draft task");
    }
    const baseline = await capturePlanningBaseline({
      projectRoot: this.store.projectRoot,
      task,
    });
    return this.store.recordPlanningBaseline({
      taskId: task.taskId,
      baseline,
    });
  }

  async reserveAcceptedProjectTask(projectTask) {
    const normalized = normalizeAcceptedProjectTask(projectTask);
    const task = this.store.reserveAcceptedProjectTask(normalized);
    persistAcceptedProjectTaskProjection({
      projectRoot: this.store.projectRoot,
      task,
      snapshot: normalized,
    });
    const policy = getRegisteredValidationPolicy(this.store.projectRoot);
    const baselineCatalog = await loadTrackedBaselineCatalog({
      projectRoot: this.store.projectRoot,
    });
    const guardResult = await validatePlanningGuards({
      task,
      tierPolicy: policy.tiers[task.requestedTier],
      registeredTiers: policy.registeredTiers,
      baselineCatalog,
      projectRoot: this.store.projectRoot,
    });
    if (!guardResult.ok) {
      throw new Error(`accepted project-task plan failed local planning guards: ${guardResult.errors.join("; ")}`);
    }
    if (task.status === "draft") await this.capturePlanningBaseline(task.taskId);
    return task;
  }

  activateTask(input) {
    if ([
      "registeredTiers", "registeredTiersDigest", "registryVersion", "registryDigest",
      "tierDefinitionDigest", "wrapperDigest", "policySnapshotDigest", "rosterPath", "decisionPath",
    ]
      .some((field) => Object.hasOwn(input ?? {}, field))) {
      throw new Error("activation policy and reviewer sources are derived internally; caller overrides are not permitted");
    }
    const {
      taskId,
      revision,
      taskAgent,
      expectedAuthorizationVersion = 0,
    } = input ?? {};
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`unknown local task '${taskId}'`);
    if (task.status !== "draft") throw new Error(`task '${taskId}' is not a draft`);
    if (task.authorizationVersion !== expectedAuthorizationVersion) throw new Error("stale authorization version");
    return this.store.activateTask({
      taskId,
      revision,
      taskAgent,
      expectedAuthorizationVersion,
    });
  }

  async activateAcceptedProjectTask(input) {
    const allowedFields = new Set(["taskId", "projectTask", "expectedAuthorizationVersion"]);
    if (Object.keys(input ?? {}).some((field) => !allowedFields.has(field))) {
      throw new Error("accepted project-task activation does not permit caller-selected authorization fields");
    }
    const {
      taskId,
      projectTask,
      expectedAuthorizationVersion = 0,
    } = input ?? {};
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`unknown local task '${taskId}'`);
    if (task.status !== "draft") throw new Error(`task '${taskId}' is not a draft`);
    if (task.authorizationVersion !== expectedAuthorizationVersion) {
      throw new Error("stale authorization version");
    }
    const policy = getRegisteredValidationPolicy(this.store.projectRoot);
    const baselineCatalog = await loadTrackedBaselineCatalog({
      projectRoot: this.store.projectRoot,
    });
    const guardResult = await validatePlanningGuards({
      task,
      tierPolicy: policy.tiers[task.requestedTier],
      registeredTiers: policy.registeredTiers,
      baselineCatalog,
      projectRoot: this.store.projectRoot,
    });
    if (!guardResult.ok) {
      throw new Error(`activation blocked by local planning guards: ${guardResult.errors.join("; ")}`);
    }
    return this.store.activateAcceptedProjectTask({
      taskId,
      projectTask,
      expectedAuthorizationVersion,
    });
  }

  beginRunAttempt(input = {}) {
    const prohibited = [
      "authorizationDigest", "tier", "tierDefinitionDigest", "registryDigest", "wrapperDigest",
      "reportAdapterId", "stepNames", "processIdentity",
    ];
    if (prohibited.some((field) => Object.hasOwn(input, field))) {
      throw new Error("run authorization, obligations, and process identity are derived by the coordinator");
    }
    const { taskId, expectedAuthorizationVersion, snapshot, inputDigest } = input;
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`unknown local task '${taskId}'`);
    if (task.status !== "active" || task.suspended || !task.authorizedTier) {
      throw new Error("required-tier execution requires an active, unsuspended local task");
    }
    if (task.authorizationVersion !== expectedAuthorizationVersion) {
      throw new Error("stale authorization version; run attempt rejected");
    }
    const validationPolicy = getRegisteredValidationPolicy(this.store.projectRoot);
    const tierPolicy = validationPolicy.tiers[task.authorizedTier];
    if (!tierPolicy || tierPolicy.tierDefinitionDigest !== task.tierDefinitionDigest ||
        tierPolicy.registryDigest !== task.registryDigest ||
        tierPolicy.wrapperDigest !== task.wrapperDigest ||
        task.policySnapshotDigest !== validationPolicy.snapshotDigest) {
      throw new Error("current installed validation policy differs from task authorization");
    }
    const authorizationDigest = digestJson({
      taskId: task.taskId,
      projectNamespace: task.projectNamespace,
      planVersion: task.planVersion,
      planDigest: task.planDigest,
      tier: task.authorizedTier,
      tierDefinitionDigest: task.tierDefinitionDigest,
      parametersDigest: task.parametersDigest,
      policyVersion: task.policyVersion,
      policySnapshotDigest: task.policySnapshotDigest,
      registryDigest: task.registryDigest,
      wrapperDigest: task.wrapperDigest,
      approvalDigest: task.approvalDigest,
      authorizationVersion: task.authorizationVersion,
    });
    return this.store.beginRunAttempt({
      taskId: task.taskId,
      expectedAuthorizationVersion,
      tier: task.authorizedTier,
      tierDefinitionDigest: tierPolicy.tierDefinitionDigest,
      registryDigest: tierPolicy.registryDigest,
      wrapperDigest: tierPolicy.wrapperDigest,
      reportAdapterId: tierPolicy.reportAdapterId,
      stepNames: tierPolicy.selectedStepNames,
      snapshot,
      processIdentity: this.processIdentity,
      authorizationDigest,
      inputDigest,
    });
  }

  heartbeatRunAttempt(input) {
    if (Object.hasOwn(input ?? {}, "processIdentity")) {
      throw new Error("run lease process identity is owned by the coordinator");
    }
    return this.store.heartbeatRunAttempt({
      ...input,
      processIdentity: this.processIdentity,
    });
  }

  finishRunAttempt(input) {
    return this.store.finishRunAttempt(input);
  }

  classifyStoredFailure(input) {
    return this.store.classifyStoredFailure(input);
  }

  assessOwnedRepairs(input) {
    return this.store.assessOwnedRepairs(input);
  }

  runStoredIsolationRetry(input) {
    return new FailureGateDiagnostics({ store: this.store }).runStoredIsolationRetry(input);
  }

  async completeTask(input = {}) {
    if (Object.hasOwn(input, "writerProof") || Object.hasOwn(input, "finalSnapshotDigest")) {
      throw new Error("final snapshot and writer proof are derived internally; caller overrides are not permitted");
    }
    const root = this.store.projectRoot;
    const lockDirectory = join(homedir(), ".failure-gate-v4");
    const lockPath = join(lockDirectory, "writer.lock");
    await mkdir(lockDirectory, { recursive: true, mode: 0o700 });
    return withWriterLock(lockPath, async ({ lockPath: stableLockPath, createProof }) => {
      const task = this.store.getTask(input.taskId);
      if (!task) throw new Error(`unknown local task '${input.taskId}'`);
      if (task.approvalSourceKind === "replit-project-task" && !input.projectTask) {
        throw new Error("local completion for a Replit task requires a fresh Agent-side project-task snapshot");
      }
      if (task.approvalSourceKind !== "replit-project-task" && input.projectTask !== undefined) {
        throw new Error("a project-task snapshot cannot replace the task's approved source");
      }
      const attempt = this.store.getValidationAttempt(input.attemptId);
      if (!attempt || attempt.taskId !== task.taskId) {
        throw new Error("final environment check requires the task's retained run");
      }
      const snapshot = await captureWorkspaceSnapshot(root);
      let finalContext = withRunEnvironment(snapshot);
      if (task.approvalSourceKind === "replit-project-task") {
        const acceptedSource = verifyAcceptedProjectTaskBinding({
          projectRoot: root, task, projectTask: input.projectTask,
        });
        finalContext = withAcceptedTaskSource(finalContext, acceptedSource);
      }
      if (finalContext.environmentDigest !== attempt.environmentDigest) {
        throw new Error("completion is blocked: relevant execution environment changed since validation");
      }
      const proof = createProof({
        snapshotDigest: snapshot.manifestDigest,
        snapshotIntegrity: snapshot.manifest.integrity,
        adapterId: "linux-flock-local-writer-v1",
      });
      return this.store.completeTask({
        ...input,
        finalSnapshotDigest: snapshot.manifestDigest,
        writerProof: proof,
        writerLockPath: stableLockPath,
      });
    });
  }

  quarantineOrphanedRunAttempt(input) {
    return this.store.quarantineOrphanedRunAttempt(input);
  }

  async reconcileOrphanedRunAttempt(input) {
    if (Object.keys(input ?? {}).some((key) =>
      !["attemptId", "resolution", "reason"].includes(key))) {
      throw new Error("recovery derives stopped-process proof internally; caller overrides are not permitted");
    }
    const identity = this.store.getRunProcessIdentity(input.attemptId);
    const lockDirectory = join(homedir(), ".failure-gate-v4");
    await mkdir(lockDirectory, { recursive: true, mode: 0o700 });
    return withWriterLock(join(lockDirectory, "writer.lock"), () => {
      assertRecordedRunStopped(identity);
      return this.store.reconcileOrphanedRunAttempt({
        ...input, confirmedStopped: true,
      });
    });
  }

  terminateTask(input) {
    return this.store.terminateTask(input);
  }

  close() {
    if (this.ownsStore) this.store.close();
  }
}

export { FailureGateStore };