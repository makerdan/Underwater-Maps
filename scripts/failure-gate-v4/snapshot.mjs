import { createReadStream } from "node:fs";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { relative, resolve, sep } from "node:path";
import { canonicalJson, digestJson, sha256 } from "./canonical.mjs";

const SAFE_ENVIRONMENT_KEYS = Object.freeze([
  "AUDIT_MARKER_BBOX_ENABLED",
  "CI",
  "LANG",
  "LC_ALL",
  "NODE_ENV",
  "TZ",
]);
const KNOWN_IGNORED_TOP_LEVEL = new Set([
  ".cache", ".expo", ".expo-shared", ".local", ".sass-cache", ".venv",
  "coverage", "dist", "dist-e2e", "node_modules", "out-tsc", "test-results", "tmp",
]);

function git(root, args, maxBuffer = 64 * 1024 * 1024) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer,
  });
}

function pathInsideRoot(root, path) {
  const resolved = resolve(root, path);
  return resolved === root || resolved.startsWith(`${root}${sep}`);
}

function knownIgnored(path) {
  const top = path.split("/")[0];
  return KNOWN_IGNORED_TOP_LEVEL.has(top) ||
    top.startsWith("dist-e2e") ||
    path.endsWith(".tsbuildinfo") ||
    path.endsWith(".log");
}

function isSecretBearingPath(path) {
  const name = path.split("/").at(-1).toLowerCase();
  return name === ".env" || name.startsWith(".env.") ||
    name.endsWith(".pem") || name.endsWith(".key") ||
    /(?:secret|credential|private-token)/.test(name);
}

function safeConfigDigest(path, content) {
  if (path.split("/").at(-1) !== ".npmrc") return sha256(content);
  const safeLines = content.toString("utf8").split(/\r?\n/).map((line) => {
    const separator = line.indexOf("=");
    if (separator < 0 || !/(?:auth|token|password|username)/i.test(line.slice(0, separator))) return line;
    return `${line.slice(0, separator)}=<redacted>`;
  });
  return sha256(safeLines.join("\n"));
}

async function hashRegularFile(path) {
  const initial = await stat(path, { bigint: true });
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const after = await stat(path, { bigint: true });
  const stable = initial.dev === after.dev && initial.ino === after.ino &&
    initial.size === after.size && initial.mtimeNs === after.mtimeNs &&
    initial.mode === after.mode;
  return {
    sha256: hash.digest("hex"),
    sizeBytes: Number(after.size),
    mode: Number(after.mode & 0o777n),
    stableDuringRead: stable,
  };
}

function ignoredEntries(root) {
  const output = git(root, ["status", "--porcelain=v1", "--ignored", "--untracked-files=normal", "-z"]);
  const records = output.toString("utf8").split("\0").filter(Boolean);
  return records
    .filter((record) => record.startsWith("!! "))
    .map((record) => record.slice(3))
    .sort();
}

export async function captureWorkspaceSnapshot(projectRoot) {
  const root = await realpath(resolve(projectRoot));
  const gitRoot = git(root, ["rev-parse", "--show-toplevel"]).toString("utf8").trim();
  if (await realpath(gitRoot) !== root) {
    throw new Error("snapshot project root is not the Git worktree root");
  }

  const trackedAndUntracked = git(root, [
    "ls-files", "--cached", "--others", "--exclude-standard", "-z",
  ]).toString("utf8").split("\0").filter(Boolean);
  const paths = [...new Set(trackedAndUntracked)].sort();
  const files = [];
  const reasons = [];

  for (const path of paths) {
    if (path.includes("\0") || !pathInsideRoot(root, path)) {
      reasons.push("invalid_manifest_path");
      continue;
    }
    const absolute = resolve(root, path);
    try {
      const info = await lstat(absolute, { bigint: true });
      if (!info.isFile()) {
        reasons.push("non_regular_snapshot_input");
        files.push({ path, kind: info.isSymbolicLink() ? "symlink" : "non-regular" });
        continue;
      }
      const actualPath = await realpath(absolute);
      if (!pathInsideRoot(root, relative(root, actualPath))) {
        reasons.push("snapshot_input_escapes_project_root");
        files.push({ path, kind: "escaping-input" });
        continue;
      }
      if (isSecretBearingPath(path)) {
        reasons.push("secret_bearing_input_redacted");
        files.push({
          path,
          kind: "secret-bearing-input",
          digest: null,
          contentRecorded: false,
        });
        continue;
      }
      const result = await hashRegularFile(actualPath);
      if (!result.stableDuringRead) reasons.push("input_changed_during_snapshot");
      const fileDigest = path.split("/").at(-1) === ".npmrc"
        ? safeConfigDigest(path, await readFile(actualPath))
        : result.sha256;
      files.push({
        path,
        kind: "file",
        sizeBytes: result.sizeBytes,
        mode: result.mode,
        sha256: fileDigest,
        ...(path.split("/").at(-1) === ".npmrc" ? { secretValuesRedacted: true } : {}),
      });
    } catch {
      reasons.push("snapshot_input_unreadable_or_missing");
      files.push({ path, kind: "unavailable" });
    }
  }

  const ignoredPaths = ignoredEntries(root);
  const unknownIgnoredPaths = ignoredPaths.filter((path) => !knownIgnored(path));
  if (unknownIgnoredPaths.length > 0) reasons.push("untracked_ignored_inputs_not_manifested");
  // Hashes describe one observed shared-worktree state, not an immutable run
  // snapshot. No registered writer adapter currently coordinates all writers.
  reasons.push("shared_worktree_writer_coordination_unavailable");

  const environment = {
    projectRootDigest: sha256(root),
    runtime: {
      executable: process.execPath,
      node: process.version,
      versions: process.versions,
      platform: process.platform,
      architecture: process.arch,
    },
    safeEnvironment: Object.fromEntries(SAFE_ENVIRONMENT_KEYS
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]])),
    secretBearingEnvironment: {
      databaseUrlConfigured: Boolean(process.env.DATABASE_URL),
      valuesRecorded: false,
    },
  };
  const manifest = {
    format: "failure-gate-v4-worktree-manifest-v1",
    files,
    ignoredPaths: ignoredPaths.map((path) => ({
      path,
      classification: knownIgnored(path) ? "documented-output-or-runtime-exclusion" : "unknown",
    })),
    exclusions: [
      "Git metadata",
      "ignored dependency/runtime caches and report/log directories listed in ignoredPaths",
      "secret-bearing environment variable values",
    ],
    integrity: reasons.length === 0 ? "observed-only" : "unknown",
    integrityReasons: [...new Set(reasons)].sort(),
  };
  return Object.freeze({
    manifest,
    manifestContent: canonicalJson(manifest),
    manifestDigest: digestJson(manifest),
    environment,
    environmentContent: canonicalJson(environment),
    environmentDigest: digestJson(environment),
  });
}