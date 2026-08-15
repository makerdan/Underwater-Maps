/**
 * signout-manifest.test.ts — sign-out isolation manifest guard.
 *
 * Enforces src/hooks/signoutManifest.ts against the real codebase so the
 * "new store / new localStorage key skips sign-out cleanup" bug class fails
 * loudly in CI instead of silently bleeding data between accounts on a
 * shared device:
 *
 *  1. Every store in SIGNOUT_STORE_MANIFEST exposes its sign-out reset action.
 *  2. Every Zustand store module under src/ is classified — either in
 *     SIGNOUT_STORE_MANIFEST or in SIGNOUT_EXCLUDED_STORES with a reason.
 *  3. Every raw `localStorage.setItem` key under src/ is listed in
 *     SIGNOUT_LOCALSTORAGE_MANIFEST (literal keys are read from source;
 *     non-literal call sites must be declared in SIGNOUT_DYNAMIC_WRITE_SITES).
 *  4. Every `cleared: true` manifest key is actually removed by
 *     performSignOutCleanup() — verified at runtime against real stores.
 *  5. Spot-checks that the store resets clear seeded per-user state.
 *
 * Pure store/key enumeration + source scan: no network, no rendering.
 */

import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  SIGNOUT_STORE_MANIFEST,
  SIGNOUT_EXCLUDED_STORES,
  SIGNOUT_LOCALSTORAGE_MANIFEST,
  SIGNOUT_DYNAMIC_WRITE_SITES,
  manifestCoversKey,
} from "@/hooks/signoutManifest";
import { performSignOutCleanup } from "@/hooks/signoutCleanup";
import { useTrailStore } from "@/lib/trailStore";
import { useCameraStore } from "@/lib/cameraStore";
import { useDriftStore, DRIFT_SIGNOUT_DEFAULTS } from "@/lib/driftStore";
import { useLiveModeStore } from "@/lib/liveMode";

const SRC_DIR = path.resolve(__dirname, "..");

/** Recursively list production .ts/.tsx files under src/ (tests excluded). */
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

function relModule(absPath: string): string {
  return path.relative(SRC_DIR, absPath).split(path.sep).join("/");
}

function lineOfIndex(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

const sourceFiles = listSourceFiles(SRC_DIR);

describe("sign-out isolation manifest", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  // ── 1. Store manifest entries expose their reset action ───────────────────
  it("every manifest store has a sign-out reset action", () => {
    const missing = SIGNOUT_STORE_MANIFEST.filter(
      (entry) => !entry.hasResetAction(),
    ).map((entry) => entry.storeName);
    expect(
      missing,
      `Store(s) [${missing.join(", ")}] have no resetForSignOut() action — ` +
        `add one (and wire it into performSignOutCleanup in signoutCleanup.ts) ` +
        `or mark the store as excluded in signoutManifest.ts`,
    ).toEqual([]);
  });

  // ── 1b. Every manifest store's reset is INVOKED by the cleanup routine ────
  it("performSignOutCleanup invokes every manifest store's reset action", () => {
    const invoked = new Set<string>();
    const restores = SIGNOUT_STORE_MANIFEST.map((entry) =>
      entry.installProbe(() => invoked.add(entry.storeName)),
    );
    try {
      performSignOutCleanup();
    } finally {
      // Restore in reverse order so originals come back even on throw.
      for (const restore of restores.reverse()) restore();
    }

    const notInvoked = SIGNOUT_STORE_MANIFEST.filter(
      (entry) => !invoked.has(entry.storeName),
    ).map((entry) => entry.storeName);
    expect(
      notInvoked,
      `Store reset action(s) for [${notInvoked.join(", ")}] are declared in ` +
        `SIGNOUT_STORE_MANIFEST but performSignOutCleanup never invokes them — ` +
        `wire each reset into performSignOutCleanup in signoutCleanup.ts (a ` +
        `reset that exists but is never called still bleeds state across accounts).`,
    ).toEqual([]);
  });

  // ── 2. Every Zustand store module is classified ────────────────────────────
  it("every Zustand store module is classified in the manifest", () => {
    const classified = new Set([
      ...SIGNOUT_STORE_MANIFEST.map((entry) => entry.module),
      ...SIGNOUT_EXCLUDED_STORES.map((entry) => entry.module),
    ]);

    const storeModules: string[] = [];
    for (const file of sourceFiles) {
      const src = fs.readFileSync(file, "utf-8");
      if (/from\s+["']zustand["']/.test(src) && /\bcreate[<(]/.test(src)) {
        storeModules.push(relModule(file));
      }
    }
    expect(storeModules.length).toBeGreaterThan(0);

    const unclassified = storeModules.filter((mod) => !classified.has(mod));
    expect(
      unclassified,
      `Zustand store module(s) [${unclassified.join(", ")}] are not classified ` +
        `in signoutManifest.ts — decide whether each holds per-user session ` +
        `state and add it to SIGNOUT_STORE_MANIFEST (with a resetForSignOut() ` +
        `wired into performSignOutCleanup) or to SIGNOUT_EXCLUDED_STORES with a reason.`,
    ).toEqual([]);

    // Reverse direction: catch stale manifest entries after renames/deletes.
    const onDisk = new Set(storeModules);
    const stale = [...classified].filter((mod) => !onDisk.has(mod));
    expect(
      stale,
      `Manifest store module(s) [${stale.join(", ")}] no longer exist (or no ` +
        `longer create a Zustand store) — remove or update the entries in signoutManifest.ts.`,
    ).toEqual([]);

    const doubleListed = SIGNOUT_STORE_MANIFEST.map((e) => e.module).filter(
      (mod) => SIGNOUT_EXCLUDED_STORES.some((x) => x.module === mod),
    );
    expect(
      doubleListed,
      `Store module(s) [${doubleListed.join(", ")}] are listed as both included ` +
        `and excluded in signoutManifest.ts — pick one.`,
    ).toEqual([]);
  });

  // ── 3. Every raw localStorage.setItem key is in the manifest ──────────────
  it("every raw localStorage.setItem key is listed in the manifest", () => {
    const dynamicSites = new Map(
      SIGNOUT_DYNAMIC_WRITE_SITES.map((site) => [site.module, site.keys]),
    );
    const unlistedKeys: string[] = [];
    const undeclaredDynamicSites: string[] = [];

    const literalCallRe =
      /(?:localStorage\.setItem|writeLocalBool)\(\s*(["'`])([^"'`\n]+)\1/g;
    const anyCallRe = /(?:localStorage\.setItem|writeLocalBool)\(/g;

    for (const file of sourceFiles) {
      const mod = relModule(file);
      if (mod === "hooks/signoutManifest.ts") continue;
      const src = fs.readFileSync(file, "utf-8");

      let literalCount = 0;
      for (const m of src.matchAll(literalCallRe)) {
        literalCount++;
        const key = m[2];
        if (!manifestCoversKey(key)) {
          unlistedKeys.push(`'${key}' (${mod}:${lineOfIndex(src, m.index)})`);
        }
      }

      const totalCount = [...src.matchAll(anyCallRe)].length;
      if (totalCount > literalCount) {
        // Non-literal key(s): the file must declare what it writes.
        const declared = dynamicSites.get(mod);
        if (!declared) {
          undeclaredDynamicSites.push(mod);
        } else {
          for (const key of declared) {
            if (!manifestCoversKey(key.endsWith("*") ? key.slice(0, -1) + "x" : key)) {
              unlistedKeys.push(`'${key}' (declared for ${mod})`);
            }
          }
        }
      }
    }

    expect(
      unlistedKeys,
      `localStorage key(s) ${unlistedKeys.join(", ")} are written but not listed ` +
        `in SIGNOUT_LOCALSTORAGE_MANIFEST — add each to signoutManifest.ts and ` +
        `decide whether the sign-out handler must clear it (cleared: true + a ` +
        `removal in performSignOutCleanup) or why it may stay (cleared: false + reason).`,
    ).toEqual([]);
    expect(
      undeclaredDynamicSites,
      `File(s) [${undeclaredDynamicSites.join(", ")}] call localStorage.setItem ` +
        `with a non-literal key but are not declared in SIGNOUT_DYNAMIC_WRITE_SITES — ` +
        `declare the file and the manifest key(s) it writes in signoutManifest.ts.`,
    ).toEqual([]);
  });

  // ── 4. cleared:true keys are actually removed at sign-out ─────────────────
  it("performSignOutCleanup removes every cleared:true manifest key", () => {
    const seeded: string[] = [];
    for (const entry of SIGNOUT_LOCALSTORAGE_MANIFEST) {
      if (!entry.cleared) continue;
      const key = entry.key.endsWith("*")
        ? `${entry.key.slice(0, -1)}manifest-probe`
        : entry.key;
      localStorage.setItem(key, JSON.stringify({ probe: "signout-manifest" }));
      seeded.push(key);
    }
    expect(seeded.length).toBeGreaterThan(0);

    performSignOutCleanup();

    const leaked = seeded.filter((key) => localStorage.getItem(key) !== null);
    expect(
      leaked,
      `localStorage key(s) [${leaked.join(", ")}] are marked cleared:true in the ` +
        `manifest but the sign-out handler does not remove them — update ` +
        `performSignOutCleanup in signoutCleanup.ts or the manifest.`,
    ).toEqual([]);
  });

  it("performSignOutCleanup leaves cleared:false keys alone", () => {
    const kept: string[] = [];
    for (const entry of SIGNOUT_LOCALSTORAGE_MANIFEST) {
      if (entry.cleared) continue;
      const key = entry.key.endsWith("*")
        ? `${entry.key.slice(0, -1)}manifest-probe`
        : entry.key;
      localStorage.setItem(key, "keep-me");
      kept.push(key);
    }

    performSignOutCleanup();

    const removed = kept.filter((key) => localStorage.getItem(key) === null);
    expect(
      removed,
      `localStorage key(s) [${removed.join(", ")}] are marked cleared:false in ` +
        `the manifest but performSignOutCleanup removed them — update the manifest ` +
        `to cleared:true (or stop removing them).`,
    ).toEqual([]);
  });

  // ── 5. Store resets actually clear seeded per-user state ──────────────────
  it("store resets wipe seeded per-user session state", () => {
    useTrailStore.setState({
      currentPoints: [
        { lon: -135.3, lat: 57.05, accuracy: 5, timestamp: 1, seq: 0 },
      ],
      startedAt: 12345,
    });
    useCameraStore.setState({
      crosshairGps: { lon: -135.3, lat: 57.05 },
      gpsFollowState: "following",
    });
    // Seed EVERY user-controlled driftStore data field away from its default
    // (navigation/planning state, gear, manual conditions, mode, drive-boat
    // controls, snap-to-depth, boat profile) so a partial reset fails loudly.
    useDriftStore.setState({
      savedDriftPlans: [{ id: "probe" } as never],
      skippedPlanCount: 2,
      driftPlannerActive: true,
      driftConditions: [] as never,
      driftPath: [] as never,
      driftHour: 7,
      driftStartLat: 57.05,
      driftStartLon: -135.3,
      lineLengthM: 42,
      lineWeightG: 999,
      estimatedConditions: true,
      manualWindSpeedKnots: 33,
      manualWindDegrees: 10,
      manualTidalSpeedKnots: 2.2,
      manualTidalDegrees: 90,
      manualSlackNow: true,
      driftMode: "trolling",
      boatHeadingDeg: 123,
      boatSpeedKnots: 7,
      backtroll: true,
      driveBoatReverse: true,
      driftWaypoints: [{ lat: 57, lon: -135 } as never],
      reverseDriftPath: [] as never,
      reverseModeActive: true,
      catchLat: 57.1,
      catchLon: -135.1,
      boatProfileId: "probe-profile",
      snapToDepthEnabled: true,
      snapToDepthM: 12,
    });
    useLiveModeStore.setState({ gpsRetryAttempt: 3, gpsRecoveryFailed: true });

    performSignOutCleanup();

    expect(useTrailStore.getState().currentPoints).toEqual([]);
    expect(useTrailStore.getState().startedAt).toBeNull();
    expect(useCameraStore.getState().crosshairGps).toBeNull();
    expect(useCameraStore.getState().gpsFollowState).toBe("off");
    expect(useLiveModeStore.getState().gpsRetryAttempt).toBe(0);
    expect(useLiveModeStore.getState().gpsRecoveryFailed).toBe(false);

    // Every drift data field must be back at its sign-out default.
    const drift = useDriftStore.getState() as Record<string, unknown>;
    const stillDirty = Object.entries(DRIFT_SIGNOUT_DEFAULTS)
      .filter(([k, v]) => JSON.stringify(drift[k]) !== JSON.stringify(v))
      .map(([k]) => k);
    expect(
      stillDirty,
      `driftStore field(s) [${stillDirty.join(", ")}] survived resetForSignOut — ` +
        `every user-controlled field must return to DRIFT_SIGNOUT_DEFAULTS.`,
    ).toEqual([]);
  });

  // ── 6. Drift sign-out defaults match the store's clean initial state ──────
  it("DRIFT_SIGNOUT_DEFAULTS matches driftStore's clean initial state", () => {
    // In the test environment localStorage is empty at module init, so the
    // store's initial state IS the clean-slate state a brand-new user gets.
    // Any divergence means a default drifted from the create() initializer.
    const initial = useDriftStore.getInitialState() as Record<string, unknown>;
    const mismatched = Object.entries(DRIFT_SIGNOUT_DEFAULTS)
      .filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(initial[k]))
      .map(
        ([k, v]) =>
          `${k} (default ${JSON.stringify(v)} !== initial ${JSON.stringify(initial[k])})`,
      );
    expect(
      mismatched,
      `DRIFT_SIGNOUT_DEFAULTS entries [${mismatched.join("; ")}] do not match ` +
        `driftStore's initial state — keep the sign-out defaults in lockstep ` +
        `with the create() initializers in driftStore.ts.`,
    ).toEqual([]);
  });
});
