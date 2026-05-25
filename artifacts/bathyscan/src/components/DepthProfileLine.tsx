/**
 * DepthProfileLine — renders the active depth-profile transect as a
 * bright in-scene polyline, draped slightly above the terrain surface
 * so the user can see where the cross-section was sampled from.
 *
 * Lives inside <Canvas>. Shows nothing when no profile is set.
 */
import React, { useMemo } from "react";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import { useAppState } from "@/lib/context";
import { useDepthProfileStore, depthMetresToWorldY } from "@/lib/depthProfileStore";

const LINE_HOVER_WORLD = 0.4; // raise the line slightly above the surface

export const DepthProfileLine: React.FC = () => {
  const { terrain } = useAppState();
  const profile = useDepthProfileStore((s) => s.profile);

  const points = useMemo<[number, number, number][] | null>(() => {
    if (!terrain || !profile) return null;
    return profile.points.map((p) => {
      const y = depthMetresToWorldY(p.depthM, terrain) + LINE_HOVER_WORLD;
      return [p.worldX, y, p.worldZ] as [number, number, number];
    });
  }, [terrain, profile]);

  if (!points || points.length < 2) return null;

  return (
    <>
      <Line
        points={points}
        color="#00e5ff"
        lineWidth={2}
        transparent
        opacity={0.95}
      />
      {/* Endpoint dots */}
      <mesh position={points[0]}>
        <sphereGeometry args={[0.5, 12, 12]} />
        <meshBasicMaterial color="#00e5ff" />
      </mesh>
      <mesh position={points[points.length - 1]}>
        <sphereGeometry args={[0.5, 12, 12]} />
        <meshBasicMaterial color="#00e5ff" />
      </mesh>
    </>
  );
};

// Avoid unused-import warning if THREE tree-shaking complains
void THREE;
