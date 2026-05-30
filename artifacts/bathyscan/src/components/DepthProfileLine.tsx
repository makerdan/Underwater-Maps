/**
 * DepthProfileLine — renders the active depth-profile transect as a
 * bright in-scene polyline, draped slightly above the terrain surface
 * so the user can see where the cross-section was sampled from.
 *
 * Also handles pointer hover along the transect so the user can hover
 * the line in 3D and see the corresponding sample highlight on the
 * DepthProfilePanel chart (and vice-versa).
 *
 * Path mode: while the user is accumulating waypoints (before "Finish path
 * here"), the growing route is shown as a preview polyline with a dot at
 * each waypoint. Pressing Enter finishes the path; Escape cancels it.
 *
 * Lives inside <Canvas>. Shows nothing when no profile or in-progress path.
 */
import React, { useMemo, useEffect } from "react";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import { useAppState } from "@/lib/context";
import {
  useDepthProfileStore,
  depthMetresToWorldY,
  buildPathProfile,
} from "@/lib/depthProfileStore";
import { lonLatToWorldXZ } from "@/lib/terrain";
import { useClassificationStore } from "@/lib/classificationStore";
import { useCameraStore } from "@/lib/cameraStore";
import { useUiStore } from "@/lib/uiStore";

const LINE_HOVER_WORLD = 0.4;
const HIT_RADIUS_WORLD = 1.2;
const WAYPOINT_DOT_RADIUS = 0.6;

export const DepthProfileLine: React.FC = () => {
  const { terrain } = useAppState();
  const profile = useDepthProfileStore((s) => s.profile);
  const hoverIndex = useDepthProfileStore((s) => s.hoverIndex);
  const setHoverIndex = useDepthProfileStore((s) => s.setHoverIndex);
  const profileMode = useDepthProfileStore((s) => s.profileMode);
  const pathWaypoints = useDepthProfileStore((s) => s.pathWaypoints);

  // ── Keyboard shortcuts while path mode is active ──────────────────────
  useEffect(() => {
    if (profileMode !== "path" || pathWaypoints.length < 1) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        // Finish path with existing waypoints (need ≥ 2).
        const store = useDepthProfileStore.getState();
        const wps = store.pathWaypoints;
        if (wps.length < 2) return;
        if (!terrain) return;
        const zoneMap = useClassificationStore.getState().zoneMap;
        const result = buildPathProfile(terrain, wps, zoneMap);
        store.pushProfile(result);
      } else if (e.key === "Escape") {
        useDepthProfileStore.getState().cancelPath();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [profileMode, pathWaypoints.length, terrain]);

  // ── Convert profile samples to world-space points ────────────────────
  const profilePoints = useMemo<[number, number, number][] | null>(() => {
    if (!terrain || !profile) return null;
    return profile.points.map((p) => {
      const y = depthMetresToWorldY(p.depthM, terrain) + LINE_HOVER_WORLD;
      return [p.worldX, y, p.worldZ] as [number, number, number];
    });
  }, [terrain, profile]);

  // ── Convert in-progress path waypoints to world-space points ─────────
  const pathPreviewPoints = useMemo<[number, number, number][] | null>(() => {
    if (!terrain || profileMode !== "path" || pathWaypoints.length < 1) return null;
    return pathWaypoints.map((wp) => {
      const { x, z } = lonLatToWorldXZ(wp.lon, wp.lat, terrain);
      const y = depthMetresToWorldY(wp.depth, terrain) + LINE_HOVER_WORLD;
      return [x, y, z] as [number, number, number];
    });
  }, [terrain, profileMode, pathWaypoints]);

  // ── Hit-test tube for profile line ────────────────────────────────────
  const hitGeometry = useMemo<THREE.TubeGeometry | null>(() => {
    if (!profilePoints || profilePoints.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(
      profilePoints.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      false,
      "catmullrom",
      0,
    );
    return new THREE.TubeGeometry(
      curve,
      Math.max(16, profilePoints.length - 1),
      HIT_RADIUS_WORLD,
      6,
      false,
    );
  }, [profilePoints]);

  const findNearestIndex = (hit: THREE.Vector3, pts: [number, number, number][]): number => {
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const dx = p[0] - hit.x;
      const dy = p[1] - hit.y;
      const dz = p[2] - hit.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  };

  const hoverPoint =
    profilePoints !== null &&
    hoverIndex !== null &&
    hoverIndex >= 0 &&
    hoverIndex < profilePoints.length
      ? profilePoints[hoverIndex]
      : null;

  return (
    <>
      {/* ── Completed profile line ──────────────────────────────────── */}
      {profilePoints && profilePoints.length >= 2 && (
        <>
          <Line
            points={profilePoints}
            color="#00e5ff"
            lineWidth={2}
            transparent
            opacity={0.95}
          />
          {hitGeometry ? (
            <mesh
              geometry={hitGeometry}
              onPointerMove={(e) => {
                e.stopPropagation();
                const idx = findNearestIndex(e.point, profilePoints);
                if (idx !== hoverIndex) setHoverIndex(idx);
              }}
              onPointerOut={() => setHoverIndex(null)}
            >
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          ) : null}

          {/* Endpoint dots */}
          <mesh position={profilePoints[0]}>
            <sphereGeometry args={[0.5, 12, 12]} />
            <meshBasicMaterial color="#00e5ff" />
          </mesh>
          <mesh position={profilePoints[profilePoints.length - 1]}>
            <sphereGeometry args={[0.5, 12, 12]} />
            <meshBasicMaterial color="#00e5ff" />
          </mesh>

          {/* Hover marker */}
          {hoverPoint && hoverIndex !== null && profile ? (
            <mesh
              position={hoverPoint}
              onClick={(e) => {
                e.stopPropagation();
                const sample = profile.points[hoverIndex];
                if (!sample) return;
                useCameraStore.getState().setLastClickedGps({
                  lon: sample.lon,
                  lat: sample.lat,
                  depth: sample.depthM,
                });
                useUiStore.getState().setMarkerFormOpen(true);
              }}
              onPointerOver={() => {
                if (typeof document !== "undefined") {
                  document.body.style.cursor = "pointer";
                }
              }}
              onPointerOut={() => {
                if (typeof document !== "undefined") {
                  document.body.style.cursor = "";
                }
              }}
            >
              <sphereGeometry args={[0.9, 16, 16]} />
              <meshBasicMaterial color="#00e5ff" transparent opacity={0.95} />
            </mesh>
          ) : null}
        </>
      )}

      {/* ── In-progress path preview ─────────────────────────────────── */}
      {pathPreviewPoints && pathPreviewPoints.length >= 1 && (
        <>
          {pathPreviewPoints.length >= 2 && (
            <Line
              points={pathPreviewPoints}
              color="#00e5ff"
              lineWidth={2}
              transparent
              opacity={0.75}
              dashed
              dashScale={4}
              dashSize={0.6}
              gapSize={0.4}
            />
          )}
          {/* Dot at each waypoint */}
          {pathPreviewPoints.map((pos, i) => (
            <mesh key={i} position={pos}>
              <sphereGeometry args={[WAYPOINT_DOT_RADIUS, 10, 10]} />
              <meshBasicMaterial
                color={i === 0 ? "#00e5ff" : "#ffffff"}
                transparent
                opacity={0.9}
              />
            </mesh>
          ))}
        </>
      )}
    </>
  );
};
