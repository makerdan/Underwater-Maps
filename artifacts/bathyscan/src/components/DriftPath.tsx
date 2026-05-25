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

import React, { useMemo } from "react";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import { useDriftStore } from "@/lib/driftStore";
import { lonLatToWorldXZ } from "@/lib/terrain";
import { useAppState } from "@/lib/context";

const RIBBON_COLOR = 0x22d3ee;
const BUOY_COLOR = 0x0ea5e9;
const BUOY_ACTIVE_COLOR = 0xfbbf24;
const FISHING_LINE_COLOR = 0xfde68a;

function pathCurve(waypoints: { worldX: number; worldZ: number }[], surfaceY: number): THREE.CatmullRomCurve3 {
  const pts = waypoints.map((wp) => new THREE.Vector3(wp.worldX, surfaceY + 0.08, wp.worldZ));
  return new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
}

interface DriftPathProps {
  surfaceY: number;
}

export const DriftPath: React.FC<DriftPathProps> = ({ surfaceY }) => {
  const { driftPath, driftHour, lineLengthM, driftWaypoints, driftMode } = useDriftStore();
  const { terrain } = useAppState();

  const waypointMarkers = useMemo(() => {
    if (!terrain || driftMode !== "trolling" || driftWaypoints.length === 0) return null;
    return driftWaypoints.map((wp, i) => {
      const { x, z } = lonLatToWorldXZ(wp.lon, wp.lat, terrain);
      return { x, z, index: i };
    });
  }, [terrain, driftMode, driftWaypoints]);

  const activeTarget = driftPath?.[driftHour]?.targetWaypointIndex;

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

      {/* User-placed trolling waypoints (cyan flags) */}
      {waypointMarkers && waypointMarkers.map((m) => {
        const isActive = activeTarget === m.index;
        const color = isActive ? 0xfbbf24 : 0x22d3ee;
        return (
          <group key={`wp-${m.index}`} position={[m.x, surfaceY + 0.05, m.z]}>
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
            {/* Base ring on water */}
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
