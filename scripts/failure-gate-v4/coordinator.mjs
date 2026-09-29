import { FailureGateStore } from "./store.mjs";

export class FailureGateCoordinator {
  constructor(options) {
    this.store = options.store ?? new FailureGateStore(options);
    this.ownsStore = !options.store;
  }

  reserveTask(input) {
    return this.store.reserveTask(input);
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

  close() {
    if (this.ownsStore) this.store.close();
  }
}

export { FailureGateStore };