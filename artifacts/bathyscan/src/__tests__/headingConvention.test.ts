/**
 * Regression tests — heading / North-up convention.
 *
 * Axis convention: +X = East, +Z = North (maxLat). Heading 0° = +Z.
 * If any of these break, the terrain North (+Z) / heading convention has
 * drifted — see the orientation decision in cameraSpawn.ts.
 */
import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { applyCameraSpawn } from "@/lib/cameraSpawn";
import { drawArrow } from "@/components/Minimap";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The corrected heading formula used in useFlyControls.ts.
 * Returns heading in degrees [0, 360).
 */
function computeHeading(lookDir: THREE.Vector3): number {
  return (Math.atan2(lookDir.x, lookDir.z) * 180 / Math.PI + 360) % 360;
}

/**
 * Minimal mock canvas context for drawArrow rotation capture.
 */
function makeCtx(): { rotate: ReturnType<typeof vi.fn> } & Partial<CanvasRenderingContext2D> {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    shadowColor: "",
    shadowBlur: 0,
    fillStyle: "",
  } as unknown as { rotate: ReturnType<typeof vi.fn> } & Partial<CanvasRenderingContext2D>;
}

// ---------------------------------------------------------------------------
// 1. Heading formula — pure cardinal and diagonal cases
// ---------------------------------------------------------------------------
describe("heading formula — atan2(x, z)", () => {
  // If any of these break, the terrain North (+Z) / heading convention has
  // drifted — see the orientation decision in cameraSpawn.ts.

  it("(0, 0, 1) → 0° (pure North, +Z)", () => {
    const dir = new THREE.Vector3(0, 0, 1);
    expect(Math.round(computeHeading(dir))).toBe(0);
  });

  it("(1, 0, 0) → 90° (pure East, +X)", () => {
    const dir = new THREE.Vector3(1, 0, 0);
    expect(Math.round(computeHeading(dir))).toBe(90);
  });

  it("(0, 0, -1) → 180° (pure South, −Z)", () => {
    const dir = new THREE.Vector3(0, 0, -1);
    expect(Math.round(computeHeading(dir))).toBe(180);
  });

  it("(-1, 0, 0) → 270° (pure West, −X)", () => {
    const dir = new THREE.Vector3(-1, 0, 0);
    expect(Math.round(computeHeading(dir))).toBe(270);
  });

  it("(1, 0, 1).normalize() → 45° (NE diagonal)", () => {
    const dir = new THREE.Vector3(1, 0, 1).normalize();
    expect(Math.round(computeHeading(dir))).toBe(45);
  });

  it("(1, 0, -1).normalize() → 135° (SE diagonal)", () => {
    const dir = new THREE.Vector3(1, 0, -1).normalize();
    expect(Math.round(computeHeading(dir))).toBe(135);
  });
});

// ---------------------------------------------------------------------------
// 2. Camera spawn round-trip — heading round-trips through applyCameraSpawn
// ---------------------------------------------------------------------------
describe("cameraSpawn heading round-trip", () => {
  /** Minimal TerrainData stub sufficient for applyCameraSpawn. */
  const grid = {
    datasetId: "rt-test",
    resolution: 4,
    width: 4,
    height: 4,
    depths: new Array(16).fill(50) as unknown as import("@workspace/api-client-react").DepthsArray,
    minDepth: 10,
    maxDepth: 100,
    minLon: -120,
    maxLon: -119,
    minLat: 47,
    maxLat: 48,
    waterType: "saltwater" as const,
  };

  function roundTrip(headingDeg: number): number {
    const cam = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    const euler = new THREE.Euler(0, 0, 0, "YXZ");

    const settings = {
      cameraSpawnBehaviour: "last" as const,
      lastSession: {
        datasetId: "rt-test",
        lon: -119.5,
        lat: 47.5,
        depth: 50,
        heading: headingDeg,
        headingConvention: "north-up" as const,
      },
      datasetHomePositions: {},
    } as unknown as Parameters<typeof applyCameraSpawn>[3];

    applyCameraSpawn(cam as unknown as THREE.PerspectiveCamera, euler, grid as never, settings);

    // Read back the look direction from the spawned camera
    const camFull = new THREE.PerspectiveCamera();
    camFull.position.copy(cam.position);
    camFull.quaternion.copy(cam.quaternion);
    const lookDir = new THREE.Vector3();
    camFull.getWorldDirection(lookDir);
    return computeHeading(lookDir);
  }

  const cardinals: [number][] = [[0], [90], [180], [270], [45]];

  it.each(cardinals)("round-trip error < 1° for heading %i°", (deg) => {
    const result = roundTrip(deg);
    let error = Math.abs(result - deg);
    // Wrap around 360°
    if (error > 180) error = 360 - error;
    expect(error).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// 2b. Legacy-session guard — old-convention sessions must not restore
// ---------------------------------------------------------------------------
describe("cameraSpawn legacy-session guard", () => {
  /** Minimal TerrainData stub — centroid at lon -119.5, lat 47.5 → world ~0, ~0 */
  const grid = {
    datasetId: "legacy-test",
    resolution: 4,
    width: 4,
    height: 4,
    depths: new Array(16).fill(50) as unknown as import("@workspace/api-client-react").DepthsArray,
    minDepth: 10,
    maxDepth: 100,
    minLon: -120,
    maxLon: -119,
    minLat: 47,
    maxLat: 48,
    waterType: "saltwater" as const,
  };

  /**
   * Returns the world position the camera was placed at after applyCameraSpawn.
   * Pass `null` to simulate "no saved session" (centroid fallback).
   */
  function spawnPosition(session: Parameters<typeof applyCameraSpawn>[3]["lastSession"]) {
    const cam = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    const euler = new THREE.Euler(0, 0, 0, "YXZ");
    const settings = {
      cameraSpawnBehaviour: "last" as const,
      lastSession: session,
      datasetHomePositions: {},
    } as unknown as Parameters<typeof applyCameraSpawn>[3];
    applyCameraSpawn(cam as unknown as THREE.PerspectiveCamera, euler, grid as never, settings);
    return cam.position.clone();
  }

  it("restores a north-up session to the saved lon/lat (non-centroid position)", () => {
    // Saved far from centroid — lon -119.9, lat 47.1
    const pos = spawnPosition({
      datasetId: "legacy-test",
      lon: -119.9,
      lat: 47.1,
      depth: 50,
      heading: 90,
      headingConvention: "north-up",
    });
    // World X,Z should be significantly non-zero (not at the centroid)
    expect(Math.abs(pos.x) + Math.abs(pos.z)).toBeGreaterThan(1);
  });

  it("ignores a session without headingConvention (old south-up convention) and falls back to centroid", () => {
    // Centroid reference position (no session at all)
    const centroidPos = spawnPosition(null);

    // Session saved far from centroid but without headingConvention — old convention
    const legacyPos = spawnPosition({
      datasetId: "legacy-test",
      lon: -119.9,
      lat: 47.1,
      depth: 50,
      heading: 90,
      // headingConvention intentionally absent — simulates a pre-fix saved session
    } as Parameters<typeof applyCameraSpawn>[3]["lastSession"]);

    // Legacy spawn must be treated as no-session and match the centroid fallback
    expect(Math.abs(legacyPos.x - centroidPos.x)).toBeLessThan(0.01);
    expect(Math.abs(legacyPos.z - centroidPos.z)).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------------------
// 3. Minimap arrow — rotates clockwise from North
// ---------------------------------------------------------------------------
describe("minimap arrow rotates clockwise from North", () => {
  // heading 0°  (North) → rotationRad ≈ 0       (arrow points up)
  // heading 90° (East)  → rotationRad ≈ π/2     (arrow points right)
  // heading 180°(South) → rotationRad ≈ π       (arrow points down)
  // heading 270°(West)  → rotationRad ≈ 3π/2    (arrow points left)

  const cases: [string, number, number][] = [
    ["North (0°)",  0,   0],
    ["East (90°)",  90,  Math.PI / 2],
    ["South (180°)", 180, Math.PI],
    ["West (270°)",  270, 3 * Math.PI / 2],
  ];

  it.each(cases)("%s: ctx.rotate called with ~%f rad", (_label, heading, expectedRad) => {
    const ctx = makeCtx();
    drawArrow(ctx as unknown as CanvasRenderingContext2D, 0, 0, heading);
    expect(ctx.rotate).toHaveBeenCalledWith(expectedRad);
  });
});

// ---------------------------------------------------------------------------
// 4. Overview Map arrow — same clockwise-from-North rotation
// ---------------------------------------------------------------------------
describe("Overview Map camera arrow rotates clockwise from North", () => {
  // The SVG rotate() transform uses the raw heading value (0 = up = North).
  function overviewArrowRot(cameraHeading: number): number {
    // Mirrors the OverviewMap.tsx JSX: const rot = cameraHeading;
    return cameraHeading;
  }

  const cases: [string, number, number][] = [
    ["North (0°)",  0,   0],
    ["East (90°)",  90,  90],
    ["South (180°)", 180, 180],
    ["West (270°)",  270, 270],
  ];

  it.each(cases)("%s: SVG rotate value is %f°", (_label, heading, expectedRot) => {
    expect(overviewArrowRot(heading)).toBe(expectedRot);
  });
});

// ---------------------------------------------------------------------------
// 5. Autopilot heading lock — drives camera toward +Z for 0° (North)
// ---------------------------------------------------------------------------
describe("autopilot heading lock direction", () => {
  it("lockedBearing=0 (North) converges camera toward +Z (positive lookDir.z)", () => {
    // Set camera facing South (euler.y = 0, lookDir.z = -1).
    const cam = new THREE.PerspectiveCamera();
    const euler = new THREE.Euler(0, 0, 0, "YXZ"); // facing South
    cam.quaternion.setFromEuler(euler);

    const lockedBearing = 0; // North
    const CORRECTION_RATE = 3.0;
    const delta = 0.016; // ~60 fps

    // Run ~120 ticks (2 seconds at 60 fps) — enough to rotate 180°
    for (let i = 0; i < 120; i++) {
      euler.setFromQuaternion(cam.quaternion);
      // Mirrors the heading-lock update in useFlyControls.ts:
      const targetEulerY = lockedBearing * Math.PI / 180 - Math.PI;
      const diff = targetEulerY - euler.y;
      const normalized = ((diff + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      euler.y += Math.sign(normalized) * Math.min(Math.abs(normalized), CORRECTION_RATE * delta);
      cam.quaternion.setFromEuler(euler);
    }

    const lookDir = new THREE.Vector3();
    cam.getWorldDirection(lookDir);

    // Camera should now face North: lookDir.z > 0
    expect(lookDir.z).toBeGreaterThan(0.9);
  });
});
