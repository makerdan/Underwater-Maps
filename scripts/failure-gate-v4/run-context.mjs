import { canonicalJson, digestJson, sha256 } from "./canonical.mjs";

// Safe execution identity shared by the launcher and final checker. Credential
// values are never retained; this is not a host/all-writer attestation.
export function checkedEnvironmentIdentity() {
  const e2e = {};
  const settings = Object.entries(process.env)
    .filter(([key]) => key.startsWith("E2E_") || /^VITE_.*E2E_/i.test(key) || key === "VITE_DEV_AUTH_BYPASS")
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [name, value] of settings) {
    if (/_(?:PORT)$/.test(name) && /^\d{1,5}$/.test(value)) {
      e2e[name] = { present: true, value };
    } else if (name === "E2E_REAL_CLERK" && /^(?:0|false|no)$/i.test(value)) {
      e2e[name] = { present: true, value: value.toLowerCase() };
    } else if (/SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE|KEY|DATABASE|AUTH|COOKIE|DSN|CONNECTION|ACCESS|SESSION|API|URL/i.test(name)) {
      e2e[name] = { present: true, valueRecorded: false };
    } else {
      e2e[name] = { present: true, valueDigest: sha256(value) };
    }
  }
  return {
    schemaVersion: 1,
    ci: process.env.CI === undefined
      ? { present: false }
      : /^(?:true|false|0|1)$/i.test(process.env.CI)
        ? { present: true, value: process.env.CI.toLowerCase() }
        : { present: true, valueDigest: sha256(process.env.CI) },
    e2e,
    nodeOptionsConfigured: Boolean(process.env.NODE_OPTIONS?.trim()),
  };
}

export function withRunEnvironment(snapshot) {
  const environment = JSON.parse(snapshot.environmentContent);
  environment.checkedRun = checkedEnvironmentIdentity();
  return withEnvironment(snapshot, environment);
}

export function withAcceptedTaskSource(snapshot, source) {
  const environment = JSON.parse(snapshot.environmentContent);
  environment.acceptedProjectTask = {
    policyId: source.policyId,
    taskRef: source.snapshot.taskRef,
    state: source.snapshot.state,
    updatedAt: source.snapshot.updatedAt,
    descriptionDigest: source.descriptionDigest,
    snapshotDigest: source.sourceDigest,
  };
  return withEnvironment(snapshot, environment);
}

function withEnvironment(snapshot, environment) {
  return {
    ...snapshot,
    environmentContent: canonicalJson(environment),
    environmentDigest: digestJson(environment),
  };
}