/**
 * DriftPath — R3F component for drift ribbon, hourly buoys, and fishing line.
 *
 * Renders:
 *   (a) A probability cone — a tapered tube geometry that widens with each
 *       forecast hour, encoding the growing position uncertainty over time.
 *       A thin centre-line tube shows the most-likely track.
 *   (b) Small sphere buoys at each hourly waypoint, numbered 1–24
 *       (active hour highlighted in yellow)
 *   (c) A fishing line descending from the active hour's waypoint at the
 *       computed angle, terminating at the estimated hook depth
 *   (d) The reverse-drift path in amber, when reverseModeActive
 */

import React, { useMemo, useRef, useEffect, useCallback, useState } from "react";
import { Line } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { useDriftStore } from "@/lib/driftStore";
import {
  lonLatToWorldXZ,
  worldXZToLonLat,
  snapWorldXZToDepthContour,
  traceDepthContourSegment,
} from "@/lib/terrain";
import { useAppState } from "@/lib/context";
import { computeDrift } from "@/lib/computeDrift";
import { useSettingsStore } from "@/lib/settingsStore";
import { sampleCurrentAt } from "@/lib/currentsStore";

const RIBBON_COLOR = 0x22d3ee;
const BUOY_COLOR = 0x0ea5e9;
const BUOY_ACTIVE_COLOR = 0xfbbf24;
const FISHING_LINE_COLOR = 0xfde68a;
const BOAT_ARROW_COLOR = 0xfbbf24;
const DRIFT_ARROW_COLOR = 0x22d3ee;
const RESULTANT_ARROW_COLOR = 0xe2e8f0;
const REVERSE_PATH_COLOR = 0xf97316; // orange — reverse drift
const CATCH_MARKER_COLOR = 0xef4444; // red — catch location
/** World units per knot for the visual force arrows. */
const ARROW_SCALE_PER_KT = 0.55;
const ARROW_MIN_LEN = 0.25;

/**
 * Build a tapered tube geometry along the drift path. The radius grows linearly
 * from minRadius at hour 0 to maxRadius at the final hour, representing the
 * widening probability envelope as forecast uncertainty accumulates over time.
 *
 * The axis of each ring cross-section is aligned with the local path tangent so
 * rings always face along the direction of travel.
 */
function buildProbabilityCone(
  waypoints: { worldX: number; worldZ: number }[],
  surfaceY: number,
  minRadius: number,
  maxRadius: number,
  radialSegments: number = 8,
): THREE.BufferGeometry {
  const N = waypoints.length;
  if (N < 2) return new THREE.BufferGeometry();

  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const radius = minRadius + t * (maxRadius - minRadius);
    const wp = waypoints[i]!;

    // Tangent direction in XZ plane
    let tx = 0;
    let tz = 0;
    if (i < N - 1) {
      tx = waypoints[i + 1]!.worldX - wp.worldX;
      tz = waypoints[i + 1]!.worldZ - wp.worldZ;
    } else if (i > 0) {
      tx = wp.worldX - waypoints[i - 1]!.worldX;
      tz = wp.worldZ - waypoints[i - 1]!.worldZ;
    }
    const tLen = Math.sqrt(tx * tx + tz * tz);
    if (tLen > 1e-9) {
      tx /= tLen;
      tz /= tLen;
    }
    // Normal perpendicular to tangent in XZ
    const nx = -tz;
    const nz = tx;

    for (let j = 0; j < radialSegments; j++) {
      const angle = (j / radialSegments) * Math.PI * 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      // Ring vertex = centre + radius * (cosA * normal_xz + sinA * up)
      positions.push(
        wp.worldX + radius * cosA * nx,
        surfaceY + 0.08 + radius * sinA,
        wp.worldZ + radius * cosA * nz,
      );
    }
  }

  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * radialSegments + j;
      const b = i * radialSegments + ((j + 1) % radialSegments);
      const c = (i + 1) * radialSegments + ((j + 1) % radialSegments);
      const d = (i + 1) * radialSegments + j;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function pathCurve(waypoints: { worldX: number; worldZ: number }[], surfaceY: number): THREE.CatmullRomCurve3 {
  const pts = waypoints.map((wp) => new THREE.Vector3(wp.worldX, surfaceY + 0.08, wp.worldZ));
  return new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
}

interface DriftPathProps {
  surfaceY: number;
}

/**
 * Flat arrow drawn on the water surface, oriented by compass bearing
 * (0=N, 90=E). Length is in world units. Used for the force overlays so
 * anglers can read boat vs drift directions at a glance.
 */
const ForceArrow: React.FC<{
  position: [number, number, number];
  headingDeg: number;
  length: number;
  color: number;
  opacity?: number;
}> = ({ position, headingDeg, length, color, opacity = 0.95 }) => {
  const shaftLen = Math.max(0, length - 0.22);
  const headLen = Math.min(0.22, Math.max(0.12, length * 0.35));
  // Compass bearing: 0=N points along -Z, 90=E along +X. R3F default cylinder
  // is along +Y; rotate it to point along +X then yaw by (90° - heading).
  const yaw = ((90 - headingDeg) * Math.PI) / 180;
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      {/* Shaft along +X */}
      {shaftLen > 0.01 && (
        <mesh position={[shaftLen / 2, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <cylinderGeometry args={[0.04, 0.04, shaftLen, 8]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.7}
            transparent
            opacity={opacity}
            depthTest={false}
          />
        </mesh>
      )}
      {/* Arrowhead at tip */}
      <mesh position={[shaftLen + headLen / 2, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.11, headLen, 10]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.85}
          transparent
          opacity={opacity}
          depthTest={false}
        />
      </mesh>
    </group>
  );
};

export const DriftPath: React.FC<DriftPathProps> = ({ surfaceY }) => {
  const driftPath = useDriftStore((s) => s.driftPath);
  const driftHour = useDriftStore((s) => s.driftHour);
  const lineLengthM = useDriftStore((s) => s.lineLengthM);
  const driftWaypoints = useDriftStore((s) => s.driftWaypoints);
  const driftMode = useDriftStore((s) => s.driftMode);
  // driftStartLat/Lon are read as reactive selectors so the circuit polyline
  // re-renders when the start point changes. Other physics inputs are read via
  // getState() inside recomputePath so we don't need extra selectors for them.
  const driftStartLat = useDriftStore((s) => s.driftStartLat);
  const driftStartLon = useDriftStore((s) => s.driftStartLon);
  const updateDriftWaypoint = useDriftStore((s) => s.updateDriftWaypoint);
  const removeDriftWaypoint = useDriftStore((s) => s.removeDriftWaypoint);
  const reverseDriftPath = useDriftStore((s) => s.reverseDriftPath);
  const reverseModeActive = useDriftStore((s) => s.reverseModeActive);
  const snapToDepthEnabled = useDriftStore((s) => s.snapToDepthEnabled);
  const snapToDepthM = useDriftStore((s) => s.snapToDepthM);
  const { terrain } = useAppState();
  const { camera, gl } = useThree();

  // While dragging with snap-to-depth enabled, we store the traced contour
  // segment so DriftPath can render it as a visual highlight.
  const [snapContourPoints, setSnapContourPoints] = useState<THREE.Vector3[] | null>(null);

  // Drag-to-fine-tune state for trolling waypoint flags. We track the drag in a
  // ref so pointer move/up listeners can read the latest index without
  // re-binding on every render.
  const dragStateRef = useRef<{ index: number; pointerId: number } | null>(null);
  const waterPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 1, 0), -surfaceY),
    [surfaceY],
  );
  const raycaster = useMemo(() => new THREE.Raycaster(), []);

  // Helper to recompute the drift path from the current store state.
  // Called after a flag drag ends or a waypoint is deleted so the timeline
  // and 3D path update immediately without requiring another canvas click.
  const recomputePath = useCallback(() => {
    const s = useDriftStore.getState();
    if (!terrain || !s.driftConditions || s.driftStartLat === null || s.driftStartLon === null) return;
    const currentsEnabled = useSettingsStore.getState().currentsEnabled;
    const sampleFlowAt = currentsEnabled
      ? (lat: number, lon: number) => {
          const { x, z } = lonLatToWorldXZ(lon, lat, terrain);
          return sampleCurrentAt(x, z);
        }
      : undefined;
    const path = computeDrift({
      conditions: s.driftConditions,
      startLat: s.driftStartLat,
      startLon: s.driftStartLon,
      lineLengthM: s.lineLengthM,
      lineWeightG: s.lineWeightG,
      terrain,
      mode: s.driftMode,
      boatHeadingDeg: s.boatHeadingDeg,
      boatSpeedKnots: s.boatSpeedKnots,
      sampleFlowAt,
      trollWaypoints: s.driftWaypoints,
    });
    s.setDriftPath(path);
  }, [terrain]);

  useEffect(() => {
    if (!terrain) return;
    const onMove = (ev: PointerEvent) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== ev.pointerId) return;
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(waterPlane, hit)) {
        // Snap-to-depth-contour: when enabled, move the waypoint to the nearest
        // point on the chosen depth contour and trace the contour for display.
        const snapEnabled = useDriftStore.getState().snapToDepthEnabled;
        const targetDepthM = useDriftStore.getState().snapToDepthM;
        if (snapEnabled) {
          const snapped = snapWorldXZToDepthContour(terrain, hit.x, hit.z, targetDepthM);
          if (snapped) {
            hit.x = snapped.x;
            hit.z = snapped.z;
            // Trace the contour around the snapped point for visual feedback.
            const contourPts = traceDepthContourSegment(terrain, snapped.x, snapped.z, targetDepthM);
            // surfaceY: waterPlane eq is y = surfaceY, i.e. plane.constant = -surfaceY
            const sy = -waterPlane.constant;
            const vec3pts = contourPts.map(
              (p) => new THREE.Vector3(p.x, sy + 0.2, p.z),
            );
            setSnapContourPoints(vec3pts.length >= 2 ? vec3pts : null);
          } else {
            setSnapContourPoints(null);
          }
        } else {
          setSnapContourPoints(null);
        }
        const { lon, lat } = worldXZToLonLat(hit.x, hit.z, terrain);
        updateDriftWaypoint(state.index, { lat, lon });
      }
    };
    const onUp = (ev: PointerEvent) => {
      if (dragStateRef.current?.pointerId === ev.pointerId) {
        dragStateRef.current = null;
        document.body.style.cursor = "";
        setSnapContourPoints(null);
        // Recompute the drift path now that the waypoint has been repositioned.
        recomputePath();
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      // If the component unmounts mid-drag, restore the cursor so the user
      // isn't stuck with a "grabbing" cursor after leaving Drift Planner.
      if (dragStateRef.current) {
        dragStateRef.current = null;
        document.body.style.cursor = "";
      }
    };
  }, [terrain, camera, gl, raycaster, waterPlane, updateDriftWaypoint, recomputePath]);

  const handleFlagPointerDown = useCallback(
    (index: number) => (e: ThreeEvent<PointerEvent>) => {
      // Stop the event from reaching DriftWaterPlane.onPointerDown, which would
      // otherwise treat the press as a click-to-add-waypoint.
      e.stopPropagation();
      dragStateRef.current = { index, pointerId: e.pointerId };
      document.body.style.cursor = "grabbing";
    },
    [],
  );

  const handleFlagPointerOver = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (!dragStateRef.current) document.body.style.cursor = "grab";
  }, []);

  const handleFlagPointerOut = useCallback(() => {
    if (!dragStateRef.current) document.body.style.cursor = "";
  }, []);

  // Right-click on a waypoint flag deletes it and recomputes the drift path.
  const handleFlagContextMenu = useCallback(
    (index: number) => (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      // Prevent the global canvas context menu from opening.
      e.nativeEvent?.preventDefault?.();
      removeDriftWaypoint(index);
      // recomputePath reads fresh store state via getState(), so the removed
      // waypoint is already gone by the time it runs.
      setTimeout(recomputePath, 0);
    },
    [removeDriftWaypoint, recomputePath],
  );

  const waypointMarkers = useMemo(() => {
    if (!terrain || driftMode !== "trolling" || driftWaypoints.length === 0) return null;
    return driftWaypoints.map((wp, i) => {
      const { x, z } = lonLatToWorldXZ(wp.lon, wp.lat, terrain);
      return { x, z, index: i };
    });
  }, [terrain, driftMode, driftWaypoints]);

  // ── Circuit preview polyline ──────────────────────────────────────────────
  // Draws start → WP1 → WP2 → … as a dashed amber line so the angler can
  // see the planned trolling course before/while placing waypoints.
  const circuitLinePoints = useMemo(() => {
    if (!terrain || driftMode !== "trolling" || driftWaypoints.length === 0) return null;
    if (driftStartLat === null || driftStartLon === null) return null;
    const { x: sx, z: sz } = lonLatToWorldXZ(driftStartLon, driftStartLat, terrain);
    const pts: THREE.Vector3[] = [new THREE.Vector3(sx, surfaceY + 0.15, sz)];
    for (const wp of driftWaypoints) {
      const { x, z } = lonLatToWorldXZ(wp.lon, wp.lat, terrain);
      pts.push(new THREE.Vector3(x, surfaceY + 0.15, z));
    }
    return pts;
  }, [terrain, driftMode, driftWaypoints, driftStartLat, driftStartLon, surfaceY]);

  const activeTarget = driftPath?.[driftHour]?.targetWaypointIndex;

  const forceArrows = useMemo(() => {
    if (driftMode !== "trolling" || !driftPath) return null;
    const wp = driftPath[driftHour];
    if (!wp) return null;
    const boatKt = wp.boatContributionKnots ?? 0;
    const driftKt = wp.driftContributionKnots ?? 0;
    const boatHeading = wp.boatHeadingDegSep;
    const driftHeading = wp.driftHeadingDeg;
    const resultantHeading = wp.headingDeg;
    const resultantKt = wp.driftSpeedKnots;
    const y = surfaceY + 0.32;
    return {
      origin: [wp.worldX, y, wp.worldZ] as [number, number, number],
      boat:
        boatHeading !== undefined && boatKt > 0.05
          ? { heading: boatHeading, length: Math.max(ARROW_MIN_LEN, boatKt * ARROW_SCALE_PER_KT) }
          : null,
      drift:
        driftHeading !== undefined && driftKt > 0.05
          ? { heading: driftHeading, length: Math.max(ARROW_MIN_LEN, driftKt * ARROW_SCALE_PER_KT) }
          : null,
      resultant:
        resultantKt > 0.05
          ? { heading: resultantHeading, length: Math.max(ARROW_MIN_LEN, resultantKt * ARROW_SCALE_PER_KT) }
          : null,
    };
  }, [driftMode, driftPath, driftHour, surfaceY]);

  // ── Probability cone geometry ─────────────────────────────────────────────
  // The cone widens from minRadius at hour 0 to maxRadius at hour 23,
  // representing growing forecast uncertainty. A separate thin centre tube
  // remains for the most-likely track.
  const coneMesh = useMemo(() => {
    if (!driftPath || driftPath.length < 2) return null;
    return buildProbabilityCone(driftPath, surfaceY, 0.04, 0.55, 8);
  }, [driftPath, surfaceY]);

  const centerCurve = useMemo(() => {
    if (!driftPath || driftPath.length < 2) return null;
    return pathCurve(driftPath, surfaceY);
  }, [driftPath, surfaceY]);

  const centerTubeGeo = useMemo(() => {
    if (!centerCurve || !driftPath) return null;
    return new THREE.TubeGeometry(centerCurve, driftPath.length * 4, 0.035, 6, false);
  }, [centerCurve, driftPath]);

  // ── Reverse drift path geometry ────────────────────────────────────────────
  const reverseCurve = useMemo(() => {
    if (!reverseDriftPath || reverseDriftPath.length < 2) return null;
    return pathCurve(reverseDriftPath, surfaceY);
  }, [reverseDriftPath, surfaceY]);

  const reverseTubeGeo = useMemo(() => {
    if (!reverseCurve || !reverseDriftPath) return null;
    return new THREE.TubeGeometry(reverseCurve, reverseDriftPath.length * 4, 0.05, 6, false);
  }, [reverseCurve, reverseDriftPath]);

  const fishingLinePoints = useMemo(() => {
    if (!driftPath) return null;
    const wp = driftPath[driftHour];
    if (!wp) return null;
    // During slack the line hangs vertical regardless of stored angle.
    const effectiveAngle = wp.isSlack ? 0 : wp.lineAngleDeg;
    const angleRad = (effectiveAngle * Math.PI) / 180;
    const horizontalReach = lineLengthM * Math.sin(angleRad);
    const verticalDrop = wp.isSlack ? lineLengthM : wp.hookDepthM;
    const scaleFactor = 0.015;
    const start = new THREE.Vector3(wp.worldX, surfaceY, wp.worldZ);
    const headingRad = (wp.headingDeg * Math.PI) / 180;
    const end = new THREE.Vector3(
      wp.worldX + Math.sin(headingRad + Math.PI) * horizontalReach * scaleFactor,
      surfaceY - verticalDrop * scaleFactor,
      wp.worldZ + Math.cos(headingRad + Math.PI) * horizontalReach * scaleFactor,
    );
    return [start, end];
  }, [driftPath, driftHour, surfaceY, lineLengthM]);

  if (!driftPath || driftPath.length < 2) return null;

  return (
    <group>
      {/* Probability cone — semi-transparent, widening envelope */}
      {coneMesh && (
        <mesh geometry={coneMesh} renderOrder={3}>
          <meshStandardMaterial
            color={RIBBON_COLOR}
            emissive={RIBBON_COLOR}
            emissiveIntensity={0.2}
            transparent
            opacity={0.22}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Centre-line tube — the most-likely track */}
      {centerTubeGeo && (
        <mesh geometry={centerTubeGeo} renderOrder={4}>
          <meshStandardMaterial
            color={RIBBON_COLOR}
            emissive={RIBBON_COLOR}
            emissiveIntensity={0.55}
            transparent
            opacity={0.85}
          />
        </mesh>
      )}

      {/* Hourly buoy markers — slack hours render as a hollow ring */}
      {driftPath.map((wp, i) => {
        const isActive = i === driftHour;
        const radius = isActive ? 0.28 : 0.16;
        if (wp.isSlack) {
          return (
            <mesh
              key={i}
              position={[wp.worldX, surfaceY + 0.22, wp.worldZ]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <torusGeometry args={[radius, radius * 0.22, 6, 16]} />
              <meshStandardMaterial
                color={isActive ? BUOY_ACTIVE_COLOR : 0xc084fc}
                emissive={isActive ? BUOY_ACTIVE_COLOR : 0xa855f7}
                emissiveIntensity={isActive ? 0.9 : 0.4}
              />
            </mesh>
          );
        }
        return (
          <mesh
            key={i}
            position={[wp.worldX, surfaceY + 0.22, wp.worldZ]}
          >
            <sphereGeometry args={[radius, 8, 8]} />
            <meshStandardMaterial
              color={isActive ? BUOY_ACTIVE_COLOR : BUOY_COLOR}
              emissive={isActive ? BUOY_ACTIVE_COLOR : BUOY_COLOR}
              emissiveIntensity={isActive ? 0.9 : 0.25}
            />
          </mesh>
        );
      })}

      {/* Fishing line at active hour */}
      {fishingLinePoints && (
        <Line
          points={fishingLinePoints}
          color={FISHING_LINE_COLOR}
          lineWidth={1.5}
          transparent
          opacity={0.85}
        />
      )}

      {/* Hook indicator at line end */}
      {fishingLinePoints && (
        <mesh position={fishingLinePoints[1]}>
          <sphereGeometry args={[0.08, 6, 6]} />
          <meshStandardMaterial
            color={0xfde68a}
            emissive={0xfbbf24}
            emissiveIntensity={0.7}
          />
        </mesh>
      )}

      {/* Force arrows at the active hour (trolling mode): amber = boat
          propulsion, cyan = wind+tide drift, faint white = resultant. */}
      {forceArrows && (
        <group renderOrder={6}>
          {forceArrows.resultant && (
            <ForceArrow
              position={forceArrows.origin}
              headingDeg={forceArrows.resultant.heading}
              length={forceArrows.resultant.length}
              color={RESULTANT_ARROW_COLOR}
              opacity={0.35}
            />
          )}
          {forceArrows.drift && (
            <ForceArrow
              position={forceArrows.origin}
              headingDeg={forceArrows.drift.heading}
              length={forceArrows.drift.length}
              color={DRIFT_ARROW_COLOR}
            />
          )}
          {forceArrows.boat && (
            <ForceArrow
              position={forceArrows.origin}
              headingDeg={forceArrows.boat.heading}
              length={forceArrows.boat.length}
              color={BOAT_ARROW_COLOR}
            />
          )}
        </group>
      )}

      {/* Circuit preview polyline — start → WP1 → WP2 → … (amber dashed) */}
      {circuitLinePoints && circuitLinePoints.length >= 2 && (
        <Line
          points={circuitLinePoints}
          color={0xfbbf24}
          lineWidth={1.8}
          transparent
          opacity={0.65}
          dashed
          dashSize={0.45}
          gapSize={0.25}
        />
      )}

      {/* Snap-to-depth contour highlight — magenta line tracing the depth
          isoline while the user drags a waypoint with snap enabled. */}
      {snapContourPoints && snapContourPoints.length >= 2 && (
        <Line
          points={snapContourPoints}
          color={0xf0abfc}
          lineWidth={2.5}
          transparent
          opacity={0.9}
        />
      )}

      {/* User-placed trolling waypoints (cyan flags) — right-click to delete */}
      {waypointMarkers && waypointMarkers.map((m) => {
        const isActive = activeTarget === m.index;
        const color = isActive ? 0xfbbf24 : 0x22d3ee;
        return (
          <group
            key={`wp-${m.index}`}
            position={[m.x, surfaceY + 0.05, m.z]}
            onPointerDown={handleFlagPointerDown(m.index)}
            onPointerOver={handleFlagPointerOver}
            onPointerOut={handleFlagPointerOut}
            onContextMenu={handleFlagContextMenu(m.index)}
          >
            {/* Flag pole */}
            <mesh position={[0, 0.5, 0]}>
              <cylinderGeometry args={[0.04, 0.04, 1.0, 6]} />
              <meshStandardMaterial color={0xeeeeee} />
            </mesh>
            {/* Flag */}
            <mesh position={[0.2, 0.85, 0]}>
              <boxGeometry args={[0.4, 0.22, 0.02]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={isActive ? 0.8 : 0.4} />
            </mesh>
            {/* Base ring on water — slightly larger hit target for easier grabbing */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.32, 0.06, 6, 16]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={isActive ? 0.9 : 0.35} />
            </mesh>
          </group>
        );
      })}

      {/* ── Reverse drift path ─────────────────────────────────────────────── */}
      {reverseModeActive && reverseDriftPath && reverseDriftPath.length >= 2 && (
        <group>
          {/* Orange reverse-drift tube */}
          {reverseTubeGeo && (
            <mesh geometry={reverseTubeGeo} renderOrder={5}>
              <meshStandardMaterial
                color={REVERSE_PATH_COLOR}
                emissive={REVERSE_PATH_COLOR}
                emissiveIntensity={0.5}
                transparent
                opacity={0.8}
              />
            </mesh>
          )}

          {/* Hour markers along reverse path */}
          {reverseDriftPath.map((wp, i) => {
            const isCatch = i === reverseDriftPath.length - 1;
            const radius = isCatch ? 0.36 : 0.14;
            const color = isCatch ? CATCH_MARKER_COLOR : REVERSE_PATH_COLOR;
            return (
              <mesh
                key={`rev-${i}`}
                position={[wp.worldX, surfaceY + 0.25, wp.worldZ]}
              >
                {isCatch ? (
                  <octahedronGeometry args={[0.36, 0]} />
                ) : (
                  <sphereGeometry args={[radius, 7, 7]} />
                )}
                <meshStandardMaterial
                  color={color}
                  emissive={color}
                  emissiveIntensity={isCatch ? 1.0 : 0.4}
                />
              </mesh>
            );
          })}
        </group>
      )}
    </group>
  );
};
