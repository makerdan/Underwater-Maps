import { readdirSync, readFileSync } from "node:fs";

function proc(pid) {
  const text = readFileSync(`/proc/${pid}/stat`, "utf8");
  const end = text.lastIndexOf(")");
  if (end < 0) throw new Error("malformed process identity");
  const fields = text.slice(end + 2).trim().split(/\s+/);
  if (fields.length < 20 || !/^\d+$/.test(fields[19])) {
    throw new Error("process start identity unavailable");
  }
  return { state: fields[0], processGroupId: Number(fields[2]), startTicks: fields[19] };
}

function bootId() {
  return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
}

export function captureRunProcessIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1 || process.platform !== "linux") {
    throw new Error("run process identity requires a Linux process PID");
  }
  const identity = proc(pid);
  if (identity.processGroupId !== pid) {
    throw new Error("checked run must own a distinct foreground process group");
  }
  return Object.freeze({
    pid, processGroupId: identity.processGroupId,
    startTicks: identity.startTicks, bootId: bootId(),
  });
}

/**
 * Call only while holding the stable writer lease, using identity recorded by
 * the launcher, not identity supplied by a CLI caller. A dead leader alone is
 * insufficient: descendants can keep writing after their wrapper exits.
 */
export function assertRecordedRunStopped(identity) {
  if (process.platform !== "linux" || !identity ||
      !Number.isSafeInteger(identity.pid) || identity.pid < 1 ||
      identity.processGroupId !== identity.pid ||
      !/^\d+$/.test(identity.startTicks ?? "") ||
      !/^[a-f0-9-]{36}$/.test(identity.bootId ?? "")) {
    throw new Error("recovery blocked: recorded process-group identity is unavailable or malformed");
  }
  const currentBoot = bootId();
  if (identity.bootId !== currentBoot) return { stopped: true, reason: "recorded kernel boot ended" };
  try {
    const leader = proc(identity.pid);
    if (leader.startTicks === identity.startTicks && !["Z", "X"].includes(leader.state)) {
      throw new Error("recovery blocked: the checked launcher is still running");
    }
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error;
  }
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const member = proc(entry);
      if (member.processGroupId === identity.processGroupId && !["Z", "X"].includes(member.state)) {
        throw new Error("recovery blocked: a checked-run process-group member is still running");
      }
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error;
    }
  }
  return { stopped: true, reason: "recorded process group has no live members" };
}