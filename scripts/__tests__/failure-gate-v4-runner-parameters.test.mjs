import assert from "node:assert/strict";
import test from "node:test";
import { FailureGateCheckedRunner } from "../failure-gate-v4/runner.mjs";

for (const method of ["requestRequiredValidation", "runRequiredValidation"]) {
  test(`${method} denies unauthorized fields before reading authorization or launching`, async () => {
    let read = false;
    const runner = new FailureGateCheckedRunner({
      store: {
        projectRoot: process.cwd(),
        getTask() { read = true; throw new Error("must not read a task"); },
        recordBlockedRunAttempt() { throw new Error("must not create a lease"); },
      },
    });
    for (const input of [
      null, [], "TASK-000001",
      { taskId: "TASK-000001", tier: "test-fast" },
      { taskId: "TASK-000001", parameters: {} },
      { taskId: "TASK-000001", argv: ["--skip", "test:unit"] },
      { taskId: "TASK-000001", environment: { E2E_REAL_CLERK: "1" } },
    ]) {
      await assert.rejects(runner[method](input), /rejects caller tier, parameters/);
    }
    assert.equal(read, false);
  });
}