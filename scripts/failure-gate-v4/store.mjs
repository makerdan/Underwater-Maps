import { chmodSync, mkdirSync, realpathSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { canonicalJson, digestJson } from "./canonical.mjs";
import { loadPinnedReviewerDecision } from "./git-review.mjs";
import { getRegisteredValidationPolicy } from "./policy.mjs";

const TASK_ID_PATTERN = /^TASK-\d{6,}$/;
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
}

function deriveTierStatuses(task, registeredTiers) {
  const authorized = task.status === "active" && !task.suspended ? task.authorizedTier : null;
  return Object.fromEntries(registeredTiers.map((tier) => [
    tier,
    authorized === tier ? "ALLOWED" : "NOT ALLOWED",
  ]));
}

export function defaultDatabasePath({ projectRoot, projectNamespace }) {
  const root = realpathSync(resolve(projectRoot));
  const namespace = requiredText(projectNamespace, "projectNamespace");
  const identity = createHash("sha256").update(`${root}\0${namespace}`).digest("hex");
  return join(homedir(), ".failure-gate-v4", `${identity}.sqlite`);
}

export class FailureGateStore {
  constructor({ projectNamespace, databasePath = null, projectRoot = process.cwd() }) {
    this.projectNamespace = requiredText(projectNamespace, "projectNamespace");
    this.projectRoot = realpathSync(resolve(projectRoot));
    const filePath = resolve(databasePath ?? defaultDatabasePath({
      projectRoot: this.projectRoot,
      projectNamespace,
    }));
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
    try { chmodSync(dirname(filePath), 0o700); } catch { /* Existing parent permissions are controlled by its owner. */ }
    this.database = new DatabaseSync(filePath);
    try { chmodSync(filePath, 0o600); } catch { /* SQLite may defer file creation until the first write. */ }
    this.database.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    try {
      this.#initialize();
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  #initialize() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS gate_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS allocator (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        next_sequence INTEGER NOT NULL CHECK (next_sequence > 0)
      );
      INSERT OR IGNORE INTO allocator(singleton, next_sequence) VALUES (1, 1);
      CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL UNIQUE,
        project_namespace TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'completed', 'failed', 'cancelled')),
        plan_reference TEXT NOT NULL,
        plan_version INTEGER NOT NULL CHECK (plan_version > 0),
        plan_content TEXT NOT NULL,
        plan_digest TEXT NOT NULL,
        requested_tier TEXT NOT NULL,
        authorized_tier TEXT,
        tier_definition_digest TEXT NOT NULL,
        registered_tiers_content TEXT,
        wrapper_digest TEXT,
        policy_snapshot_digest TEXT,
        parameters_content TEXT NOT NULL,
        parameters_digest TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        authorization_version INTEGER NOT NULL CHECK (authorization_version >= 0),
        suspended INTEGER NOT NULL DEFAULT 0 CHECK (suspended IN (0, 1)),
        approval_content TEXT,
        approval_digest TEXT,
        approval_source_revision TEXT,
        registry_version TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit (
        audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT REFERENCES tasks(task_id),
        action TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        details_content TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audit_task_id_idx ON audit(task_id, audit_id);
      CREATE TABLE IF NOT EXISTS validation_attempts (
        attempt_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(task_id),
        purpose TEXT NOT NULL CHECK (purpose = 'required_tier_validation'),
        status TEXT NOT NULL CHECK (status IN ('blocked', 'incomplete', 'finished')),
        lease_acquired INTEGER NOT NULL CHECK (lease_acquired IN (0, 1)),
        blocked_reasons_content TEXT NOT NULL,
        plan_reference TEXT NOT NULL,
        plan_version INTEGER NOT NULL,
        plan_digest TEXT NOT NULL,
        authorization_version INTEGER NOT NULL,
        tier TEXT NOT NULL,
        tier_definition_digest TEXT NOT NULL,
        registry_digest TEXT NOT NULL,
        wrapper_digest TEXT NOT NULL,
        report_adapter_id TEXT,
        snapshot_content TEXT NOT NULL,
        snapshot_digest TEXT NOT NULL,
        environment_content TEXT NOT NULL,
        environment_digest TEXT NOT NULL,
        step_results_content TEXT NOT NULL,
        raw_exit_status INTEGER,
        raw_output_digest TEXT,
        started_at TEXT,
        finished_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS validation_attempts_task_idx ON validation_attempts(task_id, finished_at);
    `);
    const taskColumns = new Set(this.database.prepare("PRAGMA table_info(tasks)").all().map((column) => column.name));
    if (!taskColumns.has("registered_tiers_content")) {
      this.database.exec("ALTER TABLE tasks ADD COLUMN registered_tiers_content TEXT");
    }
    if (!taskColumns.has("wrapper_digest")) {
      this.database.exec("ALTER TABLE tasks ADD COLUMN wrapper_digest TEXT");
    }
    if (!taskColumns.has("policy_snapshot_digest")) {
      this.database.exec("ALTER TABLE tasks ADD COLUMN policy_snapshot_digest TEXT");
    }
    this.#transaction(() => {
      const existing = this.database.prepare("SELECT value FROM gate_meta WHERE key = 'project_namespace'").get();
      if (existing && existing.value !== this.projectNamespace) {
        throw new Error("database project namespace mismatch; refusing to open coordinator state");
      }
      if (!existing) {
        this.database.prepare("INSERT INTO gate_meta(key, value) VALUES ('project_namespace', ?)").run(this.projectNamespace);
      }
    });
  }

  #transaction(callback, beforeCommit = null) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      if (beforeCommit) beforeCommit();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch { /* Preserve the transaction's original failure. */ }
      throw error;
    }
  }

  #appendAudit(taskId, action, details) {
    this.database.prepare(
      "INSERT INTO audit(task_id, action, occurred_at, details_content) VALUES (?, ?, ?, ?)",
    ).run(taskId, action, new Date().toISOString(), canonicalJson(details));
  }

  reserveTask({ plan, planReference = "coordinator-record", tier, tierDefinitionDigest, parameters = {}, policyVersion = "4.0" }) {
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw new TypeError("plan must be a JSON object");
    const safePlan = JSON.parse(canonicalJson(plan));
    const requestedTier = requiredText(tier, "tier");
    const definitionDigest = requiredText(tierDefinitionDigest, "tierDefinitionDigest");
    const policy = requiredText(policyVersion, "policyVersion");
    const reference = requiredText(planReference, "planReference");
    if (Object.hasOwn(safePlan, "taskId") || Object.hasOwn(safePlan, "planVersion")) {
      throw new TypeError("reserved plans must not provide taskId or planVersion; the coordinator assigns both");
    }
    if (Object.hasOwn(safePlan, "projectNamespace") && safePlan.projectNamespace !== this.projectNamespace) {
      throw new Error("plan project namespace does not match this coordinator");
    }

    return this.#transaction(() => {
      const sequence = Number(this.database.prepare(
        "SELECT next_sequence FROM allocator WHERE singleton = 1",
      ).get().next_sequence);
      const taskId = `TASK-${String(sequence).padStart(6, "0")}`;
      const canonicalPlan = {
        ...safePlan,
        projectNamespace: this.projectNamespace,
        taskId,
        planVersion: 1,
      };
      const planContent = canonicalJson(canonicalPlan);
      const planDigest = digestJson(canonicalPlan);
      const parametersContent = canonicalJson(parameters);
      const parametersDigest = digestJson(parameters);
      const now = new Date().toISOString();
      this.database.prepare("UPDATE allocator SET next_sequence = ? WHERE singleton = 1").run(sequence + 1);
      this.database.prepare(`
        INSERT INTO tasks (
          task_id, sequence, project_namespace, status, plan_reference, plan_version,
          plan_content, plan_digest, requested_tier, tier_definition_digest,
          parameters_content, parameters_digest, policy_version, authorization_version,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'draft', ?, 1, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(
        taskId, sequence, this.projectNamespace, reference, planContent, planDigest,
        requestedTier, definitionDigest, parametersContent, parametersDigest, policy, now, now,
      );
      this.#appendAudit(taskId, "reserved", {
        status: "draft",
        planVersion: 1,
        planDigest,
        tier: requestedTier,
        authorizationVersion: 0,
      });
      return this.getTask(taskId);
    });
  }

  activateTask(options) {
    if ([
      "rosterPath", "decisionPath", "registeredTiers", "registeredTiersDigest", "registryVersion",
      "registryDigest", "tierDefinitionDigest", "wrapperDigest", "policySnapshotDigest",
    ]
      .some((field) => Object.hasOwn(options ?? {}, field))) {
      throw new Error("activation policy and reviewer sources are derived internally; caller overrides are not permitted");
    }
    const {
      taskId,
      revision,
      taskAgent,
      expectedAuthorizationVersion = 0,
    } = options ?? {};
    const id = requiredText(taskId, "taskId");
    if (!TASK_ID_PATTERN.test(id)) throw new TypeError("taskId is not a local Failure Gate ID");
    if (!Number.isInteger(expectedAuthorizationVersion) || expectedAuthorizationVersion < 0) {
      throw new TypeError("expectedAuthorizationVersion must be a non-negative integer");
    }
    const initialTask = this.#getTask(id);
    if (!initialTask) throw new Error(`unknown local task '${id}'`);
    if (initialTask.status !== "draft") throw new Error(`task '${id}' is not a draft`);
    if (initialTask.authorizationVersion !== expectedAuthorizationVersion) throw new Error("stale authorization version");

    const initialPolicy = getRegisteredValidationPolicy(this.projectRoot);
    const initialTierPolicy = initialPolicy.tiers[initialTask.requestedTier];
    if (!initialTierPolicy) throw new Error("activation blocked: requested tier is not registered by the installed policy");
    if (initialTask.tierDefinitionDigest !== initialTierPolicy.tierDefinitionDigest) {
      throw new Error("activation blocked: reserved tier-definition digest differs from installed validation policy");
    }

    return this.#transaction(() => {
      const task = this.#getTask(id);
      if (!task) throw new Error(`unknown local task '${id}'`);
      if (task.projectNamespace !== this.projectNamespace) throw new Error("task namespace mismatch");
      if (task.status !== "draft") throw new Error(`task '${id}' is not a draft`);
      if (task.authorizationVersion !== expectedAuthorizationVersion) throw new Error("stale authorization version");
      if (task.planDigest !== initialTask.planDigest ||
          task.tierDefinitionDigest !== initialTask.tierDefinitionDigest ||
          task.requestedTier !== initialTask.requestedTier) {
        throw new Error("task plan or tier authorization changed during activation");
      }
      const transactionPolicy = getRegisteredValidationPolicy(this.projectRoot);
      if (transactionPolicy.snapshotDigest !== initialPolicy.snapshotDigest) {
        throw new Error("activation blocked: installed validation policy changed during activation");
      }
      const tierPolicy = transactionPolicy.tiers[task.requestedTier];
      if (!tierPolicy || tierPolicy.tierDefinitionDigest !== task.tierDefinitionDigest) {
        throw new Error("activation blocked: installed tier definition no longer matches the reserved task");
      }
      const review = loadPinnedReviewerDecision({
        projectRoot: this.projectRoot,
        revision,
        task,
        taskAgent,
        validationPolicy: transactionPolicy,
      });
      const approval = review.approval;
      this.#validateApproval(task, approval, transactionPolicy);

      const newTask = {
        ...task,
        status: "active",
        authorizedTier: task.requestedTier,
        authorizationVersion: task.authorizationVersion + 1,
        suspended: false,
        registeredTiers: transactionPolicy.registeredTiers,
        registryVersion: transactionPolicy.registryDigest,
        wrapperDigest: transactionPolicy.wrapperDigest,
        policySnapshotDigest: transactionPolicy.snapshotDigest,
      };
      const tierStatusSnapshot = deriveTierStatuses(newTask, transactionPolicy.registeredTiers);
      const now = new Date().toISOString();
      const result = this.database.prepare(`
        UPDATE tasks SET status = 'active', authorized_tier = requested_tier,
          authorization_version = ?, approval_content = ?, approval_digest = ?,
          approval_source_revision = ?, registry_version = ?, registered_tiers_content = ?,
          wrapper_digest = ?, policy_snapshot_digest = ?, updated_at = ?
        WHERE task_id = ? AND status = 'draft' AND authorization_version = ?
      `).run(
        newTask.authorizationVersion,
        canonicalJson(approval),
        digestJson(approval),
        approval.sourceRevision,
        transactionPolicy.registryDigest,
        canonicalJson(transactionPolicy.registeredTiers),
        transactionPolicy.wrapperDigest,
        transactionPolicy.snapshotDigest,
        now,
        id,
        expectedAuthorizationVersion,
      );
      if (Number(result.changes) !== 1) throw new Error("activation compare-and-swap failed");
      this.#appendAudit(id, "activated", {
        projectNamespace: task.projectNamespace,
        planVersion: task.planVersion,
        planDigest: task.planDigest,
        tier: task.requestedTier,
        tierDefinitionDigest: task.tierDefinitionDigest,
        parametersDigest: task.parametersDigest,
        policyVersion: task.policyVersion,
        authorizationVersion: newTask.authorizationVersion,
        approvalDigest: digestJson(approval),
        approvalSourceRevision: approval.sourceRevision,
        registeredTiers: transactionPolicy.registeredTiers,
        registryDigest: transactionPolicy.registryDigest,
        wrapperDigest: transactionPolicy.wrapperDigest,
        policySnapshotDigest: transactionPolicy.snapshotDigest,
        tierStatuses: tierStatusSnapshot,
      });
      return this.#getTask(id);
    }, () => {
      const commitPolicy = getRegisteredValidationPolicy(this.projectRoot);
      if (commitPolicy.snapshotDigest !== initialPolicy.snapshotDigest) {
        throw new Error("activation blocked: installed validation policy changed before commit");
      }
    });
  }

  #validateApproval(task, approval, policy) {
    if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
      throw new Error("activation blocked: a verified committed reviewer decision is required");
    }
    const expected = {
      taskId: task.taskId,
      projectNamespace: task.projectNamespace,
      planVersion: task.planVersion,
      planDigest: task.planDigest,
      tier: task.requestedTier,
      tierDefinitionDigest: task.tierDefinitionDigest,
      registeredTiers: policy.registeredTiers,
      registeredTiersDigest: digestJson(policy.registeredTiers),
      registryDigest: policy.registryDigest,
      wrapperDigest: policy.wrapperDigest,
      policySnapshotDigest: policy.snapshotDigest,
      parametersDigest: task.parametersDigest,
      policyVersion: task.policyVersion,
      authorizationVersion: task.authorizationVersion + 1,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (Array.isArray(value)
        ? canonicalJson(approval[key]) !== canonicalJson(value)
        : approval[key] !== value) {
        throw new Error(`activation blocked: reviewer decision does not match ${key}`);
      }
    }
    if (approval.decision !== "approved") throw new Error("activation blocked: reviewer decision is not approved");
    if (!["admin", "Dan"].includes(approval.reviewerId)) throw new Error("activation blocked: reviewer must be admin or Dan");
    requiredText(approval.reference, "review decision reference");
    requiredText(approval.sourceRevision, "pinned reviewer source revision");
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(approval.sourceRevision)) {
      throw new Error("activation blocked: reviewer source is not pinned to a full Git commit ID");
    }
    for (const field of ["reviewerRosterDigest", "decisionContentDigest"]) {
      if (typeof approval[field] !== "string" || !/^[0-9a-f]{64}$/.test(approval[field])) {
        throw new Error(`activation blocked: verified ${field} is missing`);
      }
    }
  }

  #getTask(taskId) {
    const row = this.database.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId);
    if (!row) return null;
    const plan = JSON.parse(row.plan_content);
    const parameters = JSON.parse(row.parameters_content);
    if (canonicalJson(plan) !== row.plan_content || digestJson(plan) !== row.plan_digest ||
        plan.taskId !== row.task_id || plan.projectNamespace !== this.projectNamespace ||
        plan.planVersion !== Number(row.plan_version)) {
      throw new Error(`task '${taskId}' has a malformed or stale canonical plan record`);
    }
    if (canonicalJson(parameters) !== row.parameters_content || digestJson(parameters) !== row.parameters_digest) {
      throw new Error(`task '${taskId}' has a malformed or stale permitted-parameters record`);
    }
    if (row.project_namespace !== this.projectNamespace) {
      throw new Error(`task '${taskId}' belongs to a different project namespace`);
    }
    if (row.status === "draft" && (row.authorized_tier !== null || Number(row.authorization_version) !== 0 ||
        row.registered_tiers_content !== null || row.registry_version !== null ||
        row.wrapper_digest !== null || row.policy_snapshot_digest !== null)) {
      throw new Error(`draft task '${taskId}' contains an unauthorized tier assignment`);
    }
    if (row.status === "active" &&
        (row.authorized_tier !== row.requested_tier || Number(row.authorization_version) < 1 ||
         !row.approval_content || !row.approval_digest || !row.approval_source_revision ||
         !row.registered_tiers_content || !row.registry_version ||
         !row.wrapper_digest || !row.policy_snapshot_digest)) {
      throw new Error(`active task '${taskId}' has incomplete authorization state`);
    }
    if (TERMINAL_STATUSES.has(row.status) && row.authorized_tier !== null) {
      throw new Error(`terminal task '${taskId}' retains an authorized tier`);
    }
    const approval = row.approval_content ? JSON.parse(row.approval_content) : null;
    if (approval && digestJson(approval) !== row.approval_digest) {
      throw new Error(`task '${taskId}' has a malformed reviewer decision record`);
    }
    const registeredTiers = row.registered_tiers_content ? JSON.parse(row.registered_tiers_content) : null;
    if (registeredTiers &&
        (canonicalJson(registeredTiers) !== row.registered_tiers_content ||
         !Array.isArray(registeredTiers) ||
         new Set(registeredTiers).size !== registeredTiers.length ||
         approval.registryDigest !== row.registry_version ||
         approval.wrapperDigest !== row.wrapper_digest ||
         approval.policySnapshotDigest !== row.policy_snapshot_digest ||
         approval.tier !== row.authorized_tier ||
         approval.tierDefinitionDigest !== row.tier_definition_digest ||
         canonicalJson(approval.registeredTiers) !== row.registered_tiers_content ||
         approval.registeredTiersDigest !== digestJson(registeredTiers))) {
      throw new Error(`task '${taskId}' has inconsistent installed validation policy approval state`);
    }
    return {
      taskId: row.task_id,
      projectNamespace: row.project_namespace,
      status: row.status,
      planReference: row.plan_reference,
      planVersion: Number(row.plan_version),
      plan,
      planDigest: row.plan_digest,
      requestedTier: row.requested_tier,
      authorizedTier: row.authorized_tier,
      tierDefinitionDigest: row.tier_definition_digest,
      registeredTiers,
      registryDigest: row.registry_version,
      wrapperDigest: row.wrapper_digest,
      policySnapshotDigest: row.policy_snapshot_digest,
      parameters,
      parametersDigest: row.parameters_digest,
      policyVersion: row.policy_version,
      authorizationVersion: Number(row.authorization_version),
      suspended: Boolean(row.suspended),
      approval,
      approvalDigest: row.approval_digest,
      approvalSourceRevision: row.approval_source_revision,
      registryVersion: row.registry_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getTask(taskId) {
    const id = requiredText(taskId, "taskId");
    if (!TASK_ID_PATTERN.test(id)) throw new TypeError("taskId is not a local Failure Gate ID");
    return this.#getTask(id);
  }

  tierStatuses(taskId, ...callerSuppliedTiers) {
    if (callerSuppliedTiers.length > 0) {
      throw new Error("tier status registry is derived from the installed validation policy");
    }
    const task = this.getTask(taskId);
    if (!task) throw new Error(`unknown local task '${taskId}'`);
    const policy = getRegisteredValidationPolicy(this.projectRoot);
    if (task.status === "active" &&
        (task.policySnapshotDigest !== policy.snapshotDigest ||
         canonicalJson(task.registeredTiers) !== canonicalJson(policy.registeredTiers) ||
         task.tierDefinitionDigest !== policy.tiers[task.authorizedTier]?.tierDefinitionDigest)) {
      throw new Error("active task authorization differs from the installed validation policy");
    }
    return deriveTierStatuses(task, policy.registeredTiers);
  }

  auditEvents(taskId) {
    const id = requiredText(taskId, "taskId");
    return this.database.prepare(
      "SELECT audit_id AS auditId, task_id AS taskId, action, occurred_at AS occurredAt, details_content AS details FROM audit WHERE task_id = ? ORDER BY audit_id",
    ).all(id).map((event) => ({ ...event, details: JSON.parse(event.details) }));
  }

  recordBlockedRunAttempt({
    taskId,
    expectedAuthorizationVersion,
    tier,
    tierDefinitionDigest,
    registryDigest,
    wrapperDigest,
    reportAdapterId = null,
    stepNames,
    snapshot,
    reasons,
  }) {
    const id = requiredText(taskId, "taskId");
    const normalizedReasons = [...new Set((Array.isArray(reasons) ? reasons : [])
      .map((reason) => requiredText(reason, "blocked reason")))].sort();
    if (normalizedReasons.length === 0) throw new TypeError("blocked run attempt requires an explicit reason");
    if (!Array.isArray(stepNames) || stepNames.some((name) => typeof name !== "string" || name.trim() === "")) {
      throw new TypeError("stepNames must contain registered step names");
    }
    if (new Set(stepNames).size !== stepNames.length) {
      throw new TypeError("stepNames must be unique");
    }
    if (!snapshot?.manifestContent || !snapshot?.environmentContent) {
      throw new TypeError("blocked run attempt requires a captured snapshot and environment manifest");
    }
    const manifest = JSON.parse(snapshot.manifestContent);
    const environment = JSON.parse(snapshot.environmentContent);
    if (canonicalJson(manifest) !== snapshot.manifestContent ||
        digestJson(manifest) !== snapshot.manifestDigest ||
        canonicalJson(environment) !== snapshot.environmentContent ||
        digestJson(environment) !== snapshot.environmentDigest) {
      throw new Error("blocked run attempt snapshot or environment digest is inconsistent");
    }
    const runTier = requiredText(tier, "tier");
    const definitionDigest = requiredText(tierDefinitionDigest, "tierDefinitionDigest");
    const registry = requiredText(registryDigest, "registryDigest");
    const wrapper = requiredText(wrapperDigest, "wrapperDigest");

    return this.#transaction(() => {
      const task = this.#getTask(id);
      if (!task) throw new Error(`unknown local task '${id}'`);
      if (task.status !== "active" || task.suspended) {
        throw new Error(`required validation is not authorized for task '${id}'`);
      }
      if (task.authorizationVersion !== expectedAuthorizationVersion) {
        throw new Error("stale authorization version; run attempt rejected");
      }
      if (task.authorizedTier !== runTier || task.tierDefinitionDigest !== definitionDigest) {
        throw new Error("run attempt tier or tier-definition digest differs from task authorization");
      }
      if (task.registryVersion !== registry || task.wrapperDigest !== wrapper) {
        throw new Error("run attempt registry or wrapper digest differs from task authorization");
      }

      const attemptId = randomUUID();
      const finishedAt = new Date().toISOString();
      const stepResults = stepNames.map((stepName) => ({
        stepName,
        status: "NOT_STARTED",
        rawExitStatus: null,
        rawReportReference: null,
      }));
      const row = {
        attemptId,
        taskId: id,
        purpose: "required_tier_validation",
        status: "blocked",
        leaseAcquired: false,
        blockedReasons: normalizedReasons,
        planReference: task.planReference,
        planVersion: task.planVersion,
        planDigest: task.planDigest,
        authorizationVersion: task.authorizationVersion,
        tier: runTier,
        tierDefinitionDigest: definitionDigest,
        registryDigest: registry,
        wrapperDigest: wrapper,
        reportAdapterId,
        snapshot: JSON.parse(snapshot.manifestContent),
        snapshotDigest: snapshot.manifestDigest,
        environment: JSON.parse(snapshot.environmentContent),
        environmentDigest: snapshot.environmentDigest,
        stepResults,
        rawExitStatus: null,
        rawOutputDigest: null,
        startedAt: null,
        finishedAt,
      };
      this.database.prepare(`
        INSERT INTO validation_attempts (
          attempt_id, task_id, purpose, status, lease_acquired, blocked_reasons_content,
          plan_reference, plan_version, plan_digest, authorization_version, tier,
          tier_definition_digest, registry_digest, wrapper_digest, report_adapter_id,
          snapshot_content, snapshot_digest, environment_content, environment_digest,
          step_results_content, raw_exit_status, raw_output_digest, started_at, finished_at
        ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)
      `).run(
        attemptId,
        id,
        row.purpose,
        row.status,
        canonicalJson(normalizedReasons),
        row.planReference,
        row.planVersion,
        row.planDigest,
        row.authorizationVersion,
        row.tier,
        row.tierDefinitionDigest,
        row.registryDigest,
        row.wrapperDigest,
        row.reportAdapterId,
        snapshot.manifestContent,
        row.snapshotDigest,
        snapshot.environmentContent,
        row.environmentDigest,
        canonicalJson(stepResults),
        finishedAt,
      );
      this.#appendAudit(id, "required_run_blocked", {
        attemptId,
        purpose: row.purpose,
        reasonCodes: normalizedReasons,
        planVersion: row.planVersion,
        planDigest: row.planDigest,
        authorizationVersion: row.authorizationVersion,
        tier: row.tier,
        tierDefinitionDigest: row.tierDefinitionDigest,
        registryDigest: row.registryDigest,
        wrapperDigest: row.wrapperDigest,
        reportAdapterId: row.reportAdapterId,
        snapshotDigest: row.snapshotDigest,
        snapshotIntegrity: row.snapshot.integrity,
        leaseAcquired: false,
        rawExitStatus: null,
      });
      return row;
    });
  }

  validationAttempts(taskId) {
    const id = requiredText(taskId, "taskId");
    return this.database.prepare(
      "SELECT * FROM validation_attempts WHERE task_id = ? ORDER BY finished_at, attempt_id",
    ).all(id).map((row) => ({
      attemptId: row.attempt_id,
      taskId: row.task_id,
      purpose: row.purpose,
      status: row.status,
      leaseAcquired: Boolean(row.lease_acquired),
      blockedReasons: JSON.parse(row.blocked_reasons_content),
      planReference: row.plan_reference,
      planVersion: Number(row.plan_version),
      planDigest: row.plan_digest,
      authorizationVersion: Number(row.authorization_version),
      tier: row.tier,
      tierDefinitionDigest: row.tier_definition_digest,
      registryDigest: row.registry_digest,
      wrapperDigest: row.wrapper_digest,
      reportAdapterId: row.report_adapter_id,
      snapshot: JSON.parse(row.snapshot_content),
      snapshotDigest: row.snapshot_digest,
      environment: JSON.parse(row.environment_content),
      environmentDigest: row.environment_digest,
      stepResults: JSON.parse(row.step_results_content),
      rawExitStatus: row.raw_exit_status,
      rawOutputDigest: row.raw_output_digest,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    }));
  }

  close() {
    this.database.close();
  }
}

export { TERMINAL_STATUSES };