import { spawnSync } from "node:child_process";

/**
 * Launches one already-resolved canonical validation command with the exact
 * task plan scoped to the child process. This function has no workflow or file
 * mutation path; callers must resolve the command from the plan first.
 *
 * @param {string} command
 * @param {string} planFile
 * @param {{ spawn?: typeof spawnSync, env?: NodeJS.ProcessEnv }} dependencies
 * @returns {ReturnType<typeof spawnSync>}
 */
export function launchTaskValidation(
  command,
  planFile,
  { spawn = spawnSync, env = process.env } = {},
) {
  return spawn(command, {
    shell: true,
    stdio: "inherit",
    env: { ...env, TASK_PLAN_FILE: planFile },
  });
}