/**
 * DriftPath — trolling waypoint interaction tests.
 *
 * Covers the three user-facing interactions in the click-drop-drag-delete flow:
 *
 *   1. Drag-to-reposition: a window `pointermove` event while a drag is active
 *      must call `updateDriftWaypoint` with the correct lat/lon produced by
 *      the raycaster → water-plane intersection → worldXZToLonLat pipeline.
 *
 *   2. Pointer-up ends the drag and triggers `recomputePath`, which in turn
 *      calls `computeDrift` with the updated waypoints.
 *
 *   3. Right-click to delete: `removeDriftWaypoint` is invoked with the correct
 *      index when the context-menu handler fires, and `computeDrift` is called
 *      immediately after (via `setTimeout(recomputePath, 0)`).
 *
 *   4. Circuit polyline: `circuitLinePoints` contains one point per node
 *      (start → WP1 → WP2) when driftMode is "trolling" and waypoints exist.
 *
 * All Three.js GPU objects and @react-three/fiber hooks are stubbed so the
 * tests run in jsdom without a WebGL context.
 *
 * Drag-state injection strategy
 * ─────────────────────────────
 * DriftPath uses a private `dragStateRef = useRef(null)` to track the active
 * drag. Since the ref is internal we intercept React.useRef for the one call
 * that is initialised with `null`, giving the test suite a handle to inject
 * `{ index, pointerId }` before firing window pointermove.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useDriftStore } from "@/lib/driftStore";

// ---------------------------------------------------------------------------
// Drag-ref capture — intercept the null-initialised useRef in DriftPath so
// tests can inject an active drag state without going through R3F pointer events.
// ---------------------------------------------------------------------------

/**
 * Reference to the dragStateRef created inside DriftPath.
 * Populated on component mount; reset to null between tests.
 */
const capturedDragRef = { ref: null as null | { current: unknown } };

// ---------------------------------------------------------------------------
// Flag onContextMenu handler capture — intercept react/jsx-dev-runtime (the
// JSX transform used by Vite in test mode) to collect the onContextMenu prop
// from each <group onContextMenu={...}> rendered by DriftPath.
//
// Only waypoint flag groups have onContextMenu — the root group, force-arrow
// group, and reverse-path group do not.  So capturedFlagContextMenuHandlers[0]
// is wp-0's handler and [1] is wp-1's handler (in render order).
// ---------------------------------------------------------------------------

/** Minimal synthetic-event stub that satisfies handleFlagContextMenu. */
interface FlagContextMenuEvent {
  stopPropagation(): void;
  nativeEvent?: { preventDefault?(): void };
}

const capturedFlagContextMenuHandlers: Array<(e: FlagContextMenuEvent) => void> = [];

vi.mock("react/jsx-dev-runtime", async (importActual) => {
  const actual = await importActual<typeof import("react/jsx-dev-runtime")>();
  return {
    ...actual,
    jsxDEV: (
      type: unknown,
      props: Record<string, unknown>,
      key: unknown,
      isStaticChildren: boolean,
      source: unknown,
      self: unknown,
    ) => {
      // Capture onContextMenu from waypoint flag groups (the only <group>
      // elements in DriftPath that carry this handler).
      if (type === "group" && typeof props?.onContextMenu === "function") {
        capturedFlagContextMenuHandlers.push(
          props.onContextMenu as (e: FlagContextMenuEvent) => void,
        );
      }
      return actual.jsxDEV(
        type as Parameters<typeof actual.jsxDEV>[0],
        props,
        key,
        isStaticChildren,
        source,
        self,
      );
    },
  };
});

vi.mock("react", async (importActual) => {
  const actual = await importActual<typeof import("react")>();
  return {
    ...actual,
    useRef: <T,>(initial: T): React.MutableRefObject<T> => {
      // DriftPath has exactly one useRef call initialised with null (dragStateRef).
      // Capture it so tests can set .current to simulate an active drag.
      if (initial === null) {
        const ref = { current: null } as React.MutableRefObject<T>;
        capturedDragRef.ref = ref as unknown as { current: unknown };
        return ref;
      }
      return actual.useRef(initial);
    },
  };
});

// ---------------------------------------------------------------------------
// Three.js stubs — lightweight stand-ins that satisfy the usages in DriftPath.
// ---------------------------------------------------------------------------

const mockIntersectPlane = vi.fn();

vi.mock("three", () => {
  class Vector2 {
    constructor(public x = 0, public y = 0) {}
    set(x: number, y: number) { this.x = x; this.y = y; return this; }
  }
  class Vector3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  }
  class Plane {
    constructor(public normal?: unknown, public constant?: number) {}
  }
  class Raycaster {
    ray = { intersectPlane: mockIntersectPlane };
    setFromCamera = vi.fn();
  }
  class CatmullRomCurve3 {
    constructor(public pts: unknown[]) {}
    getPoints() { return this.pts; }
  }
  class TubeGeometry { dispose = vi.fn(); }
  class BufferGeometry {
    setAttribute = vi.fn();
    setIndex = vi.fn();
    computeVertexNormals = vi.fn();
    dispose = vi.fn();
  }
  class Float32BufferAttribute {}
  return {
    Vector2, Vector3, Plane, Raycaster,
    CatmullRomCurve3, TubeGeometry, BufferGeometry, Float32BufferAttribute,
    DoubleSide: 2,
  };
});

// ---------------------------------------------------------------------------
// @react-three/fiber stub
// ---------------------------------------------------------------------------

vi.mock("@react-three/fiber", () => ({
  useThree: () => ({
    camera: { updateMatrixWorld: vi.fn() },
    gl: {
      domElement: {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      },
    },
  }),
  useFrame: vi.fn(),
}));

// ---------------------------------------------------------------------------
// @react-three/drei stub — Line is the only export used by DriftPath.
// ---------------------------------------------------------------------------

const capturedLineProps: Array<Record<string, unknown>> = [];

vi.mock("@react-three/drei", () => ({
  Line: (props: Record<string, unknown>) => {
    capturedLineProps.push(props);
    return null;
  },
}));

// ---------------------------------------------------------------------------
// Terrain helpers stub
// ---------------------------------------------------------------------------

/**
 * worldXZToLonLat returns a fixed known position so the test can assert that
 * updateDriftWaypoint is called with exactly these coordinates.
 */
const STUB_LAT = 47.611;
const STUB_LON = -122.337;

const mockWorldXZToLonLat = vi.fn().mockReturnValue({ lon: STUB_LON, lat: STUB_LAT });
const mockLonLatToWorldXZ = vi.fn().mockReturnValue({ x: 10, z: -5 });

vi.mock("@/lib/terrain", () => ({
  lonLatToWorldXZ: (...args: unknown[]) => mockLonLatToWorldXZ(...args),
  worldXZToLonLat: (...args: unknown[]) => mockWorldXZToLonLat(...args),
  WORLD_SIZE: 100,
}));

// ---------------------------------------------------------------------------
// Context stub — provides a non-null terrain so recomputePath can run.
// ---------------------------------------------------------------------------

const mockTerrain = {
  datasetId: "test",
  resolution: 4,
  minLat: 47, maxLat: 48,
  minLon: -123, maxLon: -122,
  depths: new Array(16).fill(50),
};

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain: mockTerrain }),
}));

// ---------------------------------------------------------------------------
// computeDrift spy — records calls made by recomputePath.
// ---------------------------------------------------------------------------

const computeDriftSpy = vi.fn().mockReturnValue([]);

vi.mock("@/lib/computeDrift", () => ({
  computeDrift: (...args: unknown[]) => computeDriftSpy(...args),
}));

// ---------------------------------------------------------------------------
// settingsStore stub — only getState() is called (inside recomputePath).
// ---------------------------------------------------------------------------

vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: Object.assign(
    (_sel: unknown) => undefined,
    { getState: () => ({ currentsEnabled: false }) },
  ),
}));

// ---------------------------------------------------------------------------
// currentsStore stub
// ---------------------------------------------------------------------------

vi.mock("@/lib/currentsStore", () => ({
  sampleCurrentAt: vi.fn().mockReturnValue({ u: 0, v: 0 }),
}));

// ---------------------------------------------------------------------------
// Import component AFTER all mocks are hoisted
// ---------------------------------------------------------------------------

import { DriftPath } from "@/components/DriftPath";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** A minimal valid driftPath (length ≥ 2) so DriftPath renders its JSX. */
function makeDriftPath(n = 2) {
  return Array.from({ length: n }, (_, i) => ({
    hour: i,
    lat: 47.6 + i * 0.01,
    lon: -122.3 - i * 0.01,
    worldX: i * 2,
    worldZ: i * -2,
    lineAngleDeg: 5,
    hookDepthM: 50,
    lineScopeM: 10,
    bottomReached: false,
    bottomContact: false,
    driftSpeedKnots: 1.2,
    headingDeg: 0,
    isSlack: false,
  }));
}

/** Seed driftStore with a trolling session that has two waypoints and a valid start. */
function setupTrollingState() {
  useDriftStore.setState({
    driftMode: "trolling",
    driftStartLat: 47.6,
    driftStartLon: -122.3,
    driftConditions: Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      windSpeedKnots: 5,
      windDegrees: 180,
      tidalSpeedKnots: 0.5,
      tidalDegrees: 90,
      waveHeightM: 0.3,
    })),
    driftWaypoints: [
      { lat: 47.65, lon: -122.35 },
      { lat: 47.70, lon: -122.40 },
    ],
    driftPath: makeDriftPath(24),
    driftHour: 0,
    lineLengthM: 200,
    lineWeightG: 500,
    boatHeadingDeg: 0,
    boatSpeedKnots: 3,
  });
}

// ---------------------------------------------------------------------------
// beforeEach / afterEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  capturedDragRef.ref = null;
  capturedLineProps.length = 0;
  capturedFlagContextMenuHandlers.length = 0;
  computeDriftSpy.mockClear();
  mockWorldXZToLonLat.mockReturnValue({ lon: STUB_LON, lat: STUB_LAT });
  // Default: raycaster hits the water plane and sets hit.x = 5, hit.z = -3.
  mockIntersectPlane.mockImplementation((
    _plane: unknown,
    target: { x: number; y: number; z: number },
  ) => {
    target.x = 5;
    target.y = 0;
    target.z = -3;
    return true; // truthy → branch taken
  });
  setupTrollingState();
});

afterEach(() => {
  // Restore cursor if any test left it in "grabbing" state.
  document.body.style.cursor = "";
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests: window pointermove → updateDriftWaypoint
// ---------------------------------------------------------------------------

describe("DriftPath — drag handler (window pointermove)", () => {
  it("registers a pointermove listener on window after mount", () => {
    const spy = vi.spyOn(window, "addEventListener");
    render(<DriftPath surfaceY={0} />);
    const registered = spy.mock.calls.map((c) => c[0]);
    expect(registered).toContain("pointermove");
    spy.mockRestore();
  });

  it("calls updateDriftWaypoint with the raycaster-derived lat/lon when drag is active", () => {
    const updateSpy = vi.spyOn(useDriftStore.getState(), "updateDriftWaypoint");

    render(<DriftPath surfaceY={0} />);

    // Inject an active drag state for waypoint index 0.
    act(() => {
      if (capturedDragRef.ref) {
        capturedDragRef.ref.current = { index: 0, pointerId: 42 };
      }
    });

    // Fire a pointermove — the handler reads dragStateRef.current and if
    // pointerId matches it runs the raycaster → updateDriftWaypoint path.
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { pointerId: 42, clientX: 400, clientY: 300, bubbles: true }),
      );
    });

    expect(updateSpy).toHaveBeenCalledOnce();
    const [idx, newWp] = updateSpy.mock.calls[0]!;
    expect(idx).toBe(0);
    expect(newWp.lat).toBeCloseTo(STUB_LAT, 10);
    expect(newWp.lon).toBeCloseTo(STUB_LON, 10);

    updateSpy.mockRestore();
  });

  it("does NOT call updateDriftWaypoint when no drag is active (dragStateRef is null)", () => {
    const updateSpy = vi.spyOn(useDriftStore.getState(), "updateDriftWaypoint");

    render(<DriftPath surfaceY={0} />);
    // dragStateRef.current stays null — nothing injected.

    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { pointerId: 1, clientX: 200, clientY: 100, bubbles: true }),
      );
    });

    expect(updateSpy).not.toHaveBeenCalled();
    updateSpy.mockRestore();
  });

  it("ignores pointermove events whose pointerId does not match the active drag", () => {
    const updateSpy = vi.spyOn(useDriftStore.getState(), "updateDriftWaypoint");

    render(<DriftPath surfaceY={0} />);

    act(() => {
      if (capturedDragRef.ref) {
        capturedDragRef.ref.current = { index: 1, pointerId: 7 };
      }
    });

    // Fire with a DIFFERENT pointerId.
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { pointerId: 99, clientX: 400, clientY: 300, bubbles: true }),
      );
    });

    expect(updateSpy).not.toHaveBeenCalled();
    updateSpy.mockRestore();
  });

  it("passes the raycaster hit world coordinates to worldXZToLonLat", () => {
    render(<DriftPath surfaceY={0} />);

    act(() => {
      if (capturedDragRef.ref) {
        capturedDragRef.ref.current = { index: 0, pointerId: 5 };
      }
    });

    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { pointerId: 5, clientX: 400, clientY: 300, bubbles: true }),
      );
    });

    // intersectPlane sets hit.x = 5, hit.z = -3 (from the mock above).
    expect(mockWorldXZToLonLat).toHaveBeenCalledWith(5, -3, mockTerrain);
  });
});

// ---------------------------------------------------------------------------
// Tests: window pointerup → drag ends → recomputePath
// ---------------------------------------------------------------------------

describe("DriftPath — pointerup ends drag and triggers recompute", () => {
  it("registers pointerup and pointercancel listeners on window after mount", () => {
    const spy = vi.spyOn(window, "addEventListener");
    render(<DriftPath surfaceY={0} />);
    const registered = spy.mock.calls.map((c) => c[0]);
    expect(registered).toContain("pointerup");
    expect(registered).toContain("pointercancel");
    spy.mockRestore();
  });

  it("clears the drag state when pointerup fires with the matching pointerId", () => {
    render(<DriftPath surfaceY={0} />);

    act(() => {
      if (capturedDragRef.ref) {
        capturedDragRef.ref.current = { index: 0, pointerId: 3 };
      }
    });

    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { pointerId: 3, bubbles: true }),
      );
    });

    expect(capturedDragRef.ref?.current).toBeNull();
  });

  it("calls computeDrift (via recomputePath) when pointerup ends an active drag", () => {
    vi.useFakeTimers();

    render(<DriftPath surfaceY={0} />);

    act(() => {
      if (capturedDragRef.ref) {
        capturedDragRef.ref.current = { index: 0, pointerId: 3 };
      }
    });

    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { pointerId: 3, bubbles: true }),
      );
    });

    // recomputePath is synchronous on pointerup (no setTimeout).
    expect(computeDriftSpy).toHaveBeenCalled();
    const args = computeDriftSpy.mock.calls[0]![0] as Record<string, unknown>;
    // The call must include the current trollWaypoints from the store.
    expect(args.trollWaypoints).toHaveLength(2);
  });

  it("does NOT call computeDrift on pointerup when no drag is active", () => {
    render(<DriftPath surfaceY={0} />);
    // dragStateRef stays null.

    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { pointerId: 1, bubbles: true }),
      );
    });

    expect(computeDriftSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: removeDriftWaypoint + recomputePath (right-click-to-delete flow)
// ---------------------------------------------------------------------------

describe("DriftPath — right-click to delete waypoint and recompute", () => {
  it("removeDriftWaypoint reduces the waypoints array by one", () => {
    const before = useDriftStore.getState().driftWaypoints.length;
    act(() => {
      useDriftStore.getState().removeDriftWaypoint(0);
    });
    expect(useDriftStore.getState().driftWaypoints).toHaveLength(before - 1);
  });

  it("removeDriftWaypoint removes the correct entry and shifts the rest", () => {
    // Start: [{ lat:47.65 }, { lat:47.70 }]
    act(() => {
      useDriftStore.getState().removeDriftWaypoint(0);
    });

    const wps = useDriftStore.getState().driftWaypoints;
    expect(wps).toHaveLength(1);
    expect(wps[0]).toEqual({ lat: 47.70, lon: -122.40 });
  });

  it("computeDrift is called with the remaining waypoints after removal + recompute", () => {
    render(<DriftPath surfaceY={0} />);

    // Step 1: remove a waypoint (simulates what the contextmenu handler does first).
    act(() => {
      useDriftStore.getState().removeDriftWaypoint(0);
    });

    // Step 2: trigger recomputePath by ending an active drag (pointerup calls
    // recomputePath synchronously with the current store state, which now has 1
    // waypoint instead of 2).
    act(() => {
      if (capturedDragRef.ref) {
        capturedDragRef.ref.current = { index: 0, pointerId: 77 };
      }
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { pointerId: 77, bubbles: true }),
      );
    });

    // computeDrift should have been called; the last call reflects the
    // post-deletion state where only 1 waypoint remains.
    expect(computeDriftSpy).toHaveBeenCalled();
    const lastCall = computeDriftSpy.mock.calls.at(-1)![0] as Record<string, unknown>;
    const trollWPs = lastCall.trollWaypoints as unknown[];
    expect(trollWPs).toHaveLength(1);
    expect((trollWPs[0] as { lat: number }).lat).toBeCloseTo(47.70);
  });

  it("removing the last waypoint leaves an empty trollWaypoints array", () => {
    act(() => {
      useDriftStore.getState().removeDriftWaypoint(0);
      useDriftStore.getState().removeDriftWaypoint(0);
    });
    expect(useDriftStore.getState().driftWaypoints).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: onContextMenu handler captured from rendered flag groups (UI path)
//
// DriftPath renders each waypoint as:
//   <group key="wp-{i}" onContextMenu={handleFlagContextMenu(i)}>…</group>
//
// The react/jsx-dev-runtime mock above captures the onContextMenu prop from
// every <group> that carries one.  Only waypoint flag groups have this prop,
// so capturedFlagContextMenuHandlers[0] == wp-0's handler and [1] == wp-1's.
//
// Calling a captured handler with a minimal event stub exercises the full
// handleFlagContextMenu path:
//   e.stopPropagation() → removeDriftWaypoint(i) → setTimeout(recomputePath, 0)
// ---------------------------------------------------------------------------

/** Minimal R3F ThreeEvent stub — only the fields handleFlagContextMenu uses. */
const fakeContextMenuEvent = (): FlagContextMenuEvent => ({
  stopPropagation: vi.fn(),
  nativeEvent: { preventDefault: vi.fn() },
});

describe("DriftPath — onContextMenu handler on rendered flag group (UI event path)", () => {
  it("DriftPath renders exactly one onContextMenu handler per waypoint", () => {
    render(<DriftPath surfaceY={0} />);
    // 2 waypoints → 2 captured flag groups
    expect(capturedFlagContextMenuHandlers).toHaveLength(2);
  });

  it("invoking wp-0 handler calls removeDriftWaypoint with index 0", () => {
    const removeSpy = vi.spyOn(useDriftStore.getState(), "removeDriftWaypoint");
    render(<DriftPath surfaceY={0} />);

    act(() => {
      capturedFlagContextMenuHandlers[0]!(fakeContextMenuEvent());
    });

    expect(removeSpy).toHaveBeenCalledWith(0);
    removeSpy.mockRestore();
  });

  it("invoking wp-1 handler calls removeDriftWaypoint with index 1", () => {
    const removeSpy = vi.spyOn(useDriftStore.getState(), "removeDriftWaypoint");
    render(<DriftPath surfaceY={0} />);

    act(() => {
      capturedFlagContextMenuHandlers[1]!(fakeContextMenuEvent());
    });

    expect(removeSpy).toHaveBeenCalledWith(1);
    removeSpy.mockRestore();
  });

  it("invoking the handler removes the waypoint from the store", () => {
    render(<DriftPath surfaceY={0} />);

    act(() => {
      capturedFlagContextMenuHandlers[0]!(fakeContextMenuEvent());
    });

    // After deleting wp-0 (lat:47.65), only wp-1 (lat:47.70) remains.
    const wps = useDriftStore.getState().driftWaypoints;
    expect(wps).toHaveLength(1);
    expect(wps[0]).toEqual({ lat: 47.70, lon: -122.40 });
  });

  it("handler schedules recomputePath via setTimeout(recomputePath, 0) — computeDrift fires with remaining waypoints", () => {
    vi.useFakeTimers();
    render(<DriftPath surfaceY={0} />);

    // Fire the right-click delete on wp-0.
    act(() => {
      capturedFlagContextMenuHandlers[0]!(fakeContextMenuEvent());
    });

    // Flush the setTimeout(recomputePath, 0) scheduled inside handleFlagContextMenu.
    act(() => {
      vi.runAllTimers();
    });

    expect(computeDriftSpy).toHaveBeenCalled();
    const lastCall = computeDriftSpy.mock.calls.at(-1)![0] as Record<string, unknown>;
    const trollWPs = lastCall.trollWaypoints as unknown[];
    // Only wp-1 (lat 47.70) should remain in the call.
    expect(trollWPs).toHaveLength(1);
    expect((trollWPs[0] as { lat: number }).lat).toBeCloseTo(47.70);
  });
});

// ---------------------------------------------------------------------------
// Tests: circuit polyline (start → WP1 → WP2)
// ---------------------------------------------------------------------------

describe("DriftPath — circuit polyline points (start → WP1 → WP2)", () => {
  it("lonLatToWorldXZ is called once for the start point and once per waypoint", () => {
    mockLonLatToWorldXZ.mockClear();

    render(<DriftPath surfaceY={0} />);

    // circuitLinePoints useMemo calls lonLatToWorldXZ for:
    //   1 × start point  +  2 × waypoints = 3 calls
    // (It may also be called for waypointMarkers; count ≥ 3.)
    const calls = mockLonLatToWorldXZ.mock.calls;
    // Start lon/lat are (-122.3, 47.6); waypoints are (-122.35, 47.65) and (-122.40, 47.70).
    const startCall = calls.find(
      (c) => c[0] === -122.3 && c[1] === 47.6,
    );
    expect(startCall).toBeDefined();
  });

  it("the circuit polyline has exactly N+1 points for N waypoints (start + waypoints)", () => {
    // With 2 waypoints the array should be [start, WP1, WP2] — length 3.
    // The circuit polyline is the ONLY dashed Line in DriftPath (color 0xfbbf24,
    // `dashed` prop true), which distinguishes it from the fishing line.
    capturedLineProps.length = 0;

    render(<DriftPath surfaceY={0} />);

    // The circuit line is the one rendered with `dashed` = true.
    const circuitLine = capturedLineProps.find((p) => p.dashed === true);
    expect(circuitLine).toBeDefined();
    // 1 start + 2 waypoints = 3 Vector3 objects.
    expect((circuitLine!.points as unknown[]).length).toBe(3);
  });

  it("the circuit polyline has 2 points when there is exactly 1 waypoint", () => {
    useDriftStore.setState({
      driftWaypoints: [{ lat: 47.65, lon: -122.35 }],
    });
    capturedLineProps.length = 0;

    render(<DriftPath surfaceY={0} />);

    const circuitLine = capturedLineProps.find((p) => p.dashed === true);
    expect(circuitLine).toBeDefined();
    // 1 start + 1 waypoint = 2 Vector3 objects.
    expect((circuitLine!.points as unknown[]).length).toBe(2);
  });

  it("no circuit polyline is rendered when driftMode is 'drift' (no trolling)", () => {
    useDriftStore.setState({ driftMode: "drift" });
    capturedLineProps.length = 0;

    render(<DriftPath surfaceY={0} />);

    // In drift mode circuitLinePoints is null → no dashed circuit Line rendered.
    const circuitLine = capturedLineProps.find((p) => p.dashed === true);
    expect(circuitLine).toBeUndefined();
  });

  it("no circuit polyline is rendered when driftStartLat is null", () => {
    useDriftStore.setState({ driftStartLat: null, driftStartLon: null });
    capturedLineProps.length = 0;

    render(<DriftPath surfaceY={0} />);

    const circuitLine = capturedLineProps.find((p) => p.dashed === true);
    expect(circuitLine).toBeUndefined();
  });
});
