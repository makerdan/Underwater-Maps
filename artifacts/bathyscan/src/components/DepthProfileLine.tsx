/**
 * DepthProfileLine — renders the active depth-profile transect as a
 * bright in-scene polyline, draped slightly above the terrain surface
 * so the user can see where the cross-section was sampled from.
 *
 * Also handles pointer hover along the transect so the user can hover
 * the line in 3D and see the corresponding sample highlight on the
 * DepthProfilePanel chart (and vice-versa).
 *
 * Lives inside <Canvas>. Shows nothing when no profile is set.
 */
import React, { useMemo } from "react";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import { useAppState } from "@/lib/context";
import { useDepthProfileStore, depthMetresToWorldY } from "@/lib/depthProfileStore";
import { useCameraStore } from "@/lib/cameraStore";
import { useUiStore } from "@/lib/uiStore";

const LINE_HOVER_WORLD = 0.4; // raise the line slightly above the surface
// Radius of the invisible hit-test tube wrapping the polyline. Generous
// enough that the user doesn't have to land on the 2px line exactly.
const HIT_RADIUS_WORLD = 1.2;

export const DepthProfileLine: React.FC = () => {
  const { terrain } = useAppState();
  const profile = useDepthProfileStore((s) => s.profile);
  const hoverIndex = useDepthProfileStore((s) => s.hoverIndex);
  const setHoverIndex = useDepthProfileStore((s) => s.setHoverIndex);

  const points = useMemo<[number, number, number][] | null>(() => {
    if (!terrain || !profile) return null;
    return profile.points.map((p) => {
      const y = depthMetresToWorldY(p.depthM, terrain) + LINE_HOVER_WORLD;
      return [p.worldX, y, p.worldZ] as [number, number, number];
    });
  }, [terrain, profile]);

  // Tube geometry that wraps the polyline — used purely for pointer hit
  // testing. Rendered invisible.
  const hitGeometry = useMemo<THREE.TubeGeometry | null>(() => {
    if (!points || points.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(
      points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      false,
      "catmullrom",
      0,
    );
    return new THREE.TubeGeometry(curve, Math.max(16, points.length - 1), HIT_RADIUS_WORLD, 6, false);
  }, [points]);

  if (!points || points.length < 2) return null;

  const hoverPoint =
    hoverIndex !== null && hoverIndex >= 0 && hoverIndex < points.length
      ? points[hoverIndex]
      : null;

  const findNearestIndex = (hit: THREE.Vector3): number => {
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
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

  return (
    <>
      <Line
        points={points}
        color="#00e5ff"
        lineWidth={2}
        transparent
        opacity={0.95}
      />
      {/* Invisible hit-test tube — picks up pointer hover near the line. */}
      {hitGeometry ? (
        <mesh
          geometry={hitGeometry}
          onPointerMove={(e) => {
            e.stopPropagation();
            const idx = findNearestIndex(e.point);
            if (idx !== hoverIndex) setHoverIndex(idx);
          }}
          onPointerOut={() => setHoverIndex(null)}
        >
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      ) : null}
      {/* Endpoint dots */}
      <mesh position={points[0]}>
        <sphereGeometry args={[0.5, 12, 12]} />
        <meshBasicMaterial color="#00e5ff" />
      </mesh>
      <mesh position={points[points.length - 1]}>
        <sphereGeometry args={[0.5, 12, 12]} />
        <meshBasicMaterial color="#00e5ff" />
      </mesh>
      {/* Hover marker — appears at the sample currently highlighted by
          either the SVG chart or the in-scene hit tube. Clicking it drops
          a real waypoint marker at that exact sample's lon/lat/depth. */}
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
  );
};
