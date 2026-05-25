/**
 * DriftBoat — R3F procedural low-poly fishing skiff for Drift Planner mode.
 *
 * The boat sits at the current drift hour's world position on the water surface.
 * It is oriented bow-first in the drift heading direction.
 * Click-dragging on the water surface (DriftWaterPlane) repositions the start point.
 *
 * Procedural mesh: hull (tapered box), cabin (smaller box), forward bow point (cone).
 */

import React, { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useDriftStore } from "@/lib/driftStore";

const BOAT_SCALE = 0.8;

function buildHullGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();

  const w = 0.9 * BOAT_SCALE;
  const l = 2.8 * BOAT_SCALE;
  const h = 0.35 * BOAT_SCALE;
  const stern = 0.6 * BOAT_SCALE;

  // Hull as a tapered box: bow narrows to a point
  const verts = new Float32Array([
    // Stern deck (back, full width)
    -w / 2, h,  l / 2,
     w / 2, h,  l / 2,
    // Stern keel
    -stern / 2, 0,  l / 2,
     stern / 2, 0,  l / 2,
    // Bow deck (narrows)
    -w / 4, h, -l / 2,
     w / 4, h, -l / 2,
    // Bow keel point
    0, 0, -l / 2,
    // Mid gunwale ports
    -w / 2, h, 0,
     w / 2, h, 0,
  ]);

  const indices = new Uint16Array([
    // Port side
    0, 4, 7,   4, 0, 2,
    // Starboard side
    1, 8, 5,   1, 3, 8,
    // Bow
    4, 5, 6,
    // Stern
    0, 1, 2,   1, 3, 2,
    // Deck
    0, 7, 4,   0, 4, 5,  0, 5, 1,
    // Keel
    2, 6, 3,
  ]);

  geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}

export const DriftBoat: React.FC<{ surfaceY: number }> = ({ surfaceY }) => {
  const groupRef = useRef<THREE.Group>(null);
  const rockRef = useRef(0);

  const { driftPath, driftHour, driftConditions } = useDriftStore();

  const hullGeo = useMemo(() => buildHullGeometry(), []);

  const hullMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x8b7355,
        roughness: 0.7,
        metalness: 0.1,
      }),
    [],
  );

  const cabinMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xddd5bb,
        roughness: 0.8,
        metalness: 0.0,
      }),
    [],
  );

  useFrame((_, delta) => {
    rockRef.current += delta;
    if (!groupRef.current) return;

    const waveH = driftConditions?.[driftHour]?.waveHeightM ?? 0.1;
    const rockAmp = Math.min(0.08, waveH * 0.04);
    groupRef.current.rotation.z = Math.sin(rockRef.current * 0.9) * rockAmp;
    groupRef.current.rotation.x = Math.sin(rockRef.current * 0.7 + 1.2) * rockAmp * 0.6;

    const wp = driftPath?.[driftHour];
    if (wp) {
      groupRef.current.position.set(wp.worldX, surfaceY + 0.18, wp.worldZ);
      groupRef.current.rotation.y = -(wp.headingDeg * Math.PI) / 180;
    }
  });

  const wp0 = driftPath?.[0];
  if (!wp0) return null;

  return (
    <group
      ref={groupRef}
      position={[wp0.worldX, surfaceY + 0.18, wp0.worldZ]}
    >
      {/* Hull */}
      <mesh geometry={hullGeo} material={hullMat} castShadow />

      {/* Cabin / wheelhouse */}
      <mesh position={[0, 0.35 * BOAT_SCALE + 0.15, 0.1 * BOAT_SCALE]} material={cabinMat}>
        <boxGeometry args={[0.55 * BOAT_SCALE, 0.4 * BOAT_SCALE, 0.8 * BOAT_SCALE]} />
      </mesh>

      {/* Bow flag pole */}
      <mesh position={[0, 0.55 * BOAT_SCALE, -1.2 * BOAT_SCALE]}>
        <cylinderGeometry args={[0.02, 0.02, 0.9 * BOAT_SCALE, 6]} />
        <meshStandardMaterial color={0x555555} roughness={0.9} />
      </mesh>

      {/* Running light (red port, green starboard) */}
      <mesh position={[-0.45 * BOAT_SCALE, 0.38 * BOAT_SCALE, 0]}>
        <sphereGeometry args={[0.05, 6, 6]} />
        <meshStandardMaterial color={0xff2222} emissive={0xff0000} emissiveIntensity={0.8} />
      </mesh>
      <mesh position={[0.45 * BOAT_SCALE, 0.38 * BOAT_SCALE, 0]}>
        <sphereGeometry args={[0.05, 6, 6]} />
        <meshStandardMaterial color={0x22ff44} emissive={0x00ff44} emissiveIntensity={0.8} />
      </mesh>
    </group>
  );
};
