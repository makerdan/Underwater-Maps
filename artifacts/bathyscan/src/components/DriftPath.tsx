/**
 * DriftPath — R3F component for drift ribbon, hourly buoys, and fishing line.
 *
 * Renders:
 *   (a) A TubeGeometry ribbon along the 24 computed drift waypoints
 *   (b) Small sphere buoys at each hourly waypoint, numbered 1–24
 *       (active hour highlighted in yellow)
 *   (c) A fishing line descending from the active hour's waypoint at the
 *       computed angle, terminating at the estimated hook depth
 */

import React, { useMemo, useRef, useEffect, useCallback } from "react";
import { Line } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { useDriftStore } from "@/lib/driftStore";
import { lonLatToWorldXZ, worldXZToLonLat } from "@/lib/terrain";
import { useAppState } from "@/lib/context";

const RIBBON_COLOR = 0x22d3ee;
const BUOY_COLOR = 0x0ea5e9;
const BUOY_ACTIVE_COLOR = 0xfbbf24;
const FISHING_LINE_COLOR = 0xfde68a;
const BOAT_ARROW_COLOR = 0xfbbf24;
const DRIFT_ARROW_COLOR = 0x22d3ee;
const RESULTANT_ARROW_COLOR = 0xe2e8f0;
/** World units per knot for the visual force arrows. */
const ARROW_SCALE_PER_KT = 0.55;
const ARROW_MIN_LEN = 0.25;

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
  const { driftPath, driftHour, lineLengthM, driftWaypoints, driftMode } = useDriftStore();
  const updateDriftWaypoint = useDriftStore((s) => s.updateDriftWaypoint);
  const { terrain } = useAppState();
  const { camera, gl } = useThree();

  // Drag-to-fine-tune state for trolling waypoint flags. We track the drag in a
  // ref so pointer move/up listeners can read the latest index without
  // re-binding on every render.
  const dragStateRef = useRef<{ index: number; pointerId: number } | null>(null);
  const waterPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 1, 0), -surfaceY),
    [surfaceY],
  );
  const raycaster = useMemo(() => new THREE.Raycaster(), []);

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
        const { lon, lat } = worldXZToLonLat(hit.x, hit.z, terrain);
        updateDriftWaypoint(state.index, { lat, lon });
      }
    };
    const onUp = (ev: PointerEvent) => {
      if (dragStateRef.current?.pointerId === ev.pointerId) {
        dragStateRef.current = null;
        document.body.style.cursor = "";
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
  }, [terrain, camera, gl, raycaster, waterPlane, updateDriftWaypoint]);

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

  const waypointMarkers = useMemo(() => {
    if (!terrain || driftMode !== "trolling" || driftWaypoints.length === 0) return null;
    return driftWaypoints.map((wp, i) => {
      const { x, z } = lonLatToWorldXZ(wp.lon, wp.lat, terrain);
      return { x, z, index: i };
    });
  }, [terrain, driftMode, driftWaypoints]);

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

  const curve = useMemo(() => {
    if (!driftPath || driftPath.length < 2) return null;
    return pathCurve(driftPath, surfaceY);
  }, [driftPath, surfaceY]);

  const tubeGeo = useMemo(() => {
    if (!curve) return null;
    return new THREE.TubeGeometry(curve, driftPath!.length * 4, 0.06, 6, false);
  }, [curve, driftPath]);

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
      {/* Drift ribbon */}
      {tubeGeo && (
        <mesh geometry={tubeGeo} renderOrder={4}>
          <meshStandardMaterial
            color={RIBBON_COLOR}
            emissive={RIBBON_COLOR}
            emissiveIntensity={0.4}
            transparent
            opacity={0.75}
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

      {/* User-placed trolling waypoints (cyan flags) */}
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
    </group>
  );
};
