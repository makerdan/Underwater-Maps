/**
 * Regression test for runScheduledRefresh's change detection.
 *
 * The build-* scripts embed run-time `fetchedAt` / `lastUpdated`
 * timestamps in their bundles. Without canonicalization, two runs with
 * identical upstream source data would still hash differently and the
 * wrapper would emit `[LAYER] CHANGED` on every scheduled run, defeating
 * the entire point of the schedule. This test pins down both halves:
 *   1. identical source → UNCHANGED  (no false positives from clock drift)
 *   2. different source → CHANGED    (real updates still surface)
 *
 * Run with: pnpm --filter @workspace/scripts run test
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScheduledRefresh } from "./scheduled-refresh.js";

interface CapturedLog {
  out: string[];
  err: string[];
  restore: () => void;
}

function captureConsole(): CapturedLog {
  const origLog = console.log;
  const origErr = console.error;
  const out: string[] = [];
  const err: string[] = [];
  console.log = (...args: unknown[]) => {
    out.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  console.error = (...args: unknown[]) => {
    err.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  return {
    out,
    err,
    restore() {
      console.log = origLog;
      console.error = origErr;
    },
  };
}

function tmpBundlePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "scheduled-refresh-test-"));
  return join(dir, "bundle.gen.json");
}

describe("runScheduledRefresh — hash diff canonicalization", () => {
  it("treats two builds with identical content but different fetchedAt as UNCHANGED", async () => {
    const outPath = tmpBundlePath();
    const sourceFeatures = [{ id: 1, substrate: "sand" }];

    // First build — produces the on-disk baseline.
    writeFileSync(
      outPath,
      JSON.stringify({
        features: sourceFeatures,
        meta: { fetchedAt: "2026-01-01T00:00:00.000Z", lastUpdated: "2026-01-01" },
      }),
    );

    // Second build — same source data, fresh timestamps (as the real
    // build scripts always do).
    const build = async () => {
      writeFileSync(
        outPath,
        JSON.stringify({
          features: sourceFeatures,
          meta: { fetchedAt: "2026-05-26T12:34:56.789Z", lastUpdated: "2026-05-26" },
        }),
      );
    };

    const cap = captureConsole();
    try {
      await runScheduledRefresh({
        layerLabel: "TEST",
        outPath,
        build,
        webhookEnvVar: "__UNUSED_WEBHOOK_ENV_VAR__",
      });
    } finally {
      cap.restore();
    }

    const joined = cap.out.join("\n");
    assert.match(joined, /\[TEST\] UNCHANGED/, "should report UNCHANGED when only timestamps differ");
    assert.doesNotMatch(joined, /\[TEST\] CHANGED/, "must not emit a false CHANGED alert");
  });

  it("treats two builds with different content as CHANGED even when timestamps match", async () => {
    const outPath = tmpBundlePath();
    const sharedTimestamp = "2026-05-26T12:34:56.789Z";

    writeFileSync(
      outPath,
      JSON.stringify({
        features: [{ id: 1, substrate: "sand" }],
        meta: { fetchedAt: sharedTimestamp },
      }),
    );

    const build = async () => {
      writeFileSync(
        outPath,
        JSON.stringify({
          // Real upstream change: a new survey feature appeared.
          features: [{ id: 1, substrate: "sand" }, { id: 2, substrate: "gravel" }],
          meta: { fetchedAt: sharedTimestamp },
        }),
      );
    };

    const cap = captureConsole();
    try {
      await runScheduledRefresh({
        layerLabel: "TEST",
        outPath,
        build,
        webhookEnvVar: "__UNUSED_WEBHOOK_ENV_VAR__",
      });
    } finally {
      cap.restore();
    }

    const joined = cap.out.join("\n");
    assert.match(joined, /\[TEST\] CHANGED — content-changed/, "should fire CHANGED on real content drift");
  });

  it("treats a missing baseline as CHANGED (first-ever run)", async () => {
    const outPath = tmpBundlePath();
    assert.equal(existsSync(outPath), false, "precondition: no baseline on disk");

    const build = async () => {
      writeFileSync(outPath, JSON.stringify({ features: [], meta: {} }));
    };

    const cap = captureConsole();
    try {
      await runScheduledRefresh({
        layerLabel: "TEST",
        outPath,
        build,
        webhookEnvVar: "__UNUSED_WEBHOOK_ENV_VAR__",
      });
    } finally {
      cap.restore();
    }

    const joined = cap.out.join("\n");
    assert.match(joined, /\[TEST\] CHANGED — missing-on-disk/);
  });

  it("ignores object-key ordering differences (canonical sort)", async () => {
    const outPath = tmpBundlePath();
    writeFileSync(outPath, JSON.stringify({ a: 1, b: 2, meta: { fetchedAt: "t1" } }));

    const build = async () => {
      // Same fields, different key order — should canonicalize identically.
      writeFileSync(outPath, JSON.stringify({ b: 2, meta: { fetchedAt: "t2" }, a: 1 }));
    };

    const cap = captureConsole();
    try {
      await runScheduledRefresh({
        layerLabel: "TEST",
        outPath,
        build,
        webhookEnvVar: "__UNUSED_WEBHOOK_ENV_VAR__",
      });
    } finally {
      cap.restore();
    }

    assert.match(cap.out.join("\n"), /\[TEST\] UNCHANGED/);
  });
});

// Silence unused-import lint if readFileSync ends up unused after refactors.
void readFileSync;
