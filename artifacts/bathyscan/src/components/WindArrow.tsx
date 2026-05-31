/**
 * WindArrow — R3F animated wind-direction indicator for the Drift Planner.
 *
 * Renders a 3D billboard arrow on the water surface pointing in the wind
 * direction. The arrow feathers (tail fins) animate at a rate proportional to
 * wind speed, making the applied wind vector visually obvious while the Drift
 * Planner is active.
 *
 * Positioning: centred on the active hour's waypoint, elevated ~2 world-units
 * above the surface so it is always visible above waves and the drift ribbon.
 *
 * Bearing convention (compass, 0=N):
 *   Wind blows *toward* windDegrees. The arrow points in that direction.
 *   0=N points along -Z, 90=E along +X in R3F world space.
 *   yaw = (90 - windDeg) * π/180 maps compass→R3F.
 */

import React, { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useDriftStore } from "@/lib/driftStore";

/** World-unit length of the arrow at 1 kt wind. */
const SCALE_PER_KT = 0.18;
/** Minimum arrow length (shown even at zero wind). */
const MIN_LENGTH = 0.8;
/** Maximum arrow length cap. */
const MAX_LENGTH = 6.0;
/** Elevation above surfaceY. */
const ELEVATION = 2.2;

interface WindArrowProps {
  surfaceY: number;
}

export const WindArrow: React.FC<WindArrowProps> = ({ surfaceY }) => {
  const driftPath = useDriftStore((s) => s.driftPath);
  const driftHour = useDriftStore((s) => s.driftHour);
  const driftConditions = useDriftStore((s) => s.driftConditions);

  const groupRef = useRef<THREE.Group>(null);
  const featherRef1 = useRef<THREE.Mesh>(null);
  const featherRef2 = useRef<THREE.Mesh>(null);
  const featherRef3 = useRef<THREE.Mesh>(null);
  const timeRef = useRef(0);

  const wp = driftPath?.[driftHour];
  const cond = driftConditions?.[driftHour];

  const windSpeedKnots = cond?.windSpeedKnots ?? 0;
  const windDeg = cond?.windDegrees ?? 0;

  const arrowLength = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, windSpeedKnots * SCALE_PER_KT));
  // Compass bearing to R3F yaw: 0=N(-Z), 90=E(+X)
  const yaw = ((90 - windDeg) * Math.PI) / 180;

  const shaftLen = Math.max(0.01, arrowLength - 0.4);
  const headLen = Math.min(0.4, Math.max(0.18, arrowLength * 0.22));

  // Feather geometry — small flat vanes at the tail of the arrow.
  const featherGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    // A simple elongated diamond in XY plane (gets rotated later)
    const pts = new Float32Array([
      0, 0, 0,
      -0.12, 0.22, 0,
      0, 0.44, 0,
      0.12, 0.22, 0,
    ]);
    const idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
    g.setAttribute("position", new THREE.BufferAttribute(pts, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    return g;
  }, []);

  const featherMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x93c5fd,
        emissive: 0x3b82f6,
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    [],
  );

  const shaftMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x7dd3fc,
        emissive: 0x38bdf8,
        emissiveIntensity: 0.7,
        transparent: true,
        opacity: 0.88,
        depthTest: false,
      }),
    [],
  );

  const headMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xbae6fd,
        emissive: 0x7dd3fc,
        emissiveIntensity: 0.9,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      }),
    [],
  );

  useFrame((_, delta) => {
    if (!groupRef.current || !wp) return;
    timeRef.current += delta;

    // Position above the active waypoint.
    groupRef.current.position.set(wp.worldX, surfaceY + ELEVATION, wp.worldZ);
    groupRef.current.rotation.y = yaw;

    // Animate feathers: oscillate Y-rotation at rate proportional to wind speed.
    // Faster wind → faster flapping vanes.
    const rate = 1.2 + windSpeedKnots * 0.18;
    const amp = Math.min(0.45, 0.1 + windSpeedKnots * 0.015);
    if (featherRef1.current) {
      featherRef1.current.rotation.y = Math.sin(timeRef.current * rate) * amp;
    }
    if (featherRef2.current) {
      featherRef2.current.rotation.y = Math.sin(timeRef.current * rate + 1.2) * amp;
    }
    if (featherRef3.current) {
      featherRef3.current.rotation.y = Math.sin(timeRef.current * rate + 2.4) * amp;
    }
  });

  if (!wp || !cond) return null;

  // Wind label text is rendered via HTML overlay (not R3F text) to avoid
  // font-loading complexity. The 3D arrow alone is sufficient for orientation.

  return (
    <group ref={groupRef} renderOrder={7}>
      {/* Shaft — along +X axis (compass 90°=E before yaw rotation) */}
      <mesh
        position={[shaftLen / 2, 0, 0]}
        rotation={[0, 0, -Math.PI / 2]}
        material={shaftMat}
        renderOrder={7}
      >
        <cylinderGeometry args={[0.055, 0.055, shaftLen, 8]} />
      </mesh>

      {/* Arrowhead cone at the tip */}
      <mesh
        position={[shaftLen + headLen / 2, 0, 0]}
        rotation={[0, 0, -Math.PI / 2]}
        material={headMat}
        renderOrder={7}
      >
        <coneGeometry args={[0.18, headLen, 10]} />
      </mesh>

      {/* Feather vanes at the tail — three overlapping fins offset in angle */}
      {[0, Math.PI / 3, (2 * Math.PI) / 3].map((baseAngle, i) => {
        const refs = [featherRef1, featherRef2, featherRef3];
        return (
          <mesh
            key={i}
            ref={refs[i]}
            geometry={featherGeo}
            material={featherMat}
            position={[-0.1, 0, 0]}
            rotation={[0, baseAngle, Math.PI / 2]}
            renderOrder={7}
          />
        );
      })}

      {/* Glowing base ring so the arrow's root is visible from above */}
      <mesh
        position={[0, 0, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        renderOrder={7}
      >
        <torusGeometry args={[0.22, 0.035, 6, 16]} />
        <meshStandardMaterial
          color={0x38bdf8}
          emissive={0x38bdf8}
          emissiveIntensity={0.9}
          transparent
          opacity={0.7}
          depthTest={false}
        />
      </mesh>
    </group>
  );
};
