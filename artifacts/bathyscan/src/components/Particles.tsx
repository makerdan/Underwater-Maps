import React, { useRef, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

const PARTICLE_COUNT = 2000;
const SPHERE_RADIUS = 30;

/** Safe typed-array read — noUncheckedIndexedAccess compatible. */
const r32 = (arr: Float32Array, i: number): number => arr[i] ?? 0;

export const Particles: React.FC = () => {
  const { camera } = useThree();
  const ref = useRef<THREE.Points>(null);

  const { positions, offsets, velocities } = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const offsets = new Float32Array(PARTICLE_COUNT * 3);
    const velocities = new Float32Array(PARTICLE_COUNT * 3);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const rr = SPHERE_RADIUS * Math.cbrt(Math.random());
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      offsets[i * 3] = rr * Math.sin(phi) * Math.cos(theta);
      offsets[i * 3 + 1] = rr * Math.sin(phi) * Math.sin(theta);
      offsets[i * 3 + 2] = rr * Math.cos(phi);

      // Marine snow: mostly downward drift
      velocities[i * 3] = (Math.random() - 0.5) * 0.3;
      velocities[i * 3 + 1] = -(0.3 + Math.random() * 0.8);
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.3;

      positions[i * 3] = r32(offsets, i * 3);
      positions[i * 3 + 1] = r32(offsets, i * 3 + 1);
      positions[i * 3 + 2] = r32(offsets, i * 3 + 2);
    }

    return { positions, offsets, velocities };
  }, []);

  useFrame((_, delta) => {
    if (!ref.current) return;
    const pos = ref.current.geometry.attributes["position"]!.array as Float32Array;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      offsets[i * 3] = r32(offsets, i * 3) + r32(velocities, i * 3) * delta;
      offsets[i * 3 + 1] = r32(offsets, i * 3 + 1) + r32(velocities, i * 3 + 1) * delta;
      offsets[i * 3 + 2] = r32(offsets, i * 3 + 2) + r32(velocities, i * 3 + 2) * delta;

      const ox = r32(offsets, i * 3);
      const oy = r32(offsets, i * 3 + 1);
      const oz = r32(offsets, i * 3 + 2);
      const dist2 = ox * ox + oy * oy + oz * oz;

      if (dist2 > SPHERE_RADIUS * SPHERE_RADIUS) {
        // Wrap to opposite side with slight randomisation
        const inv = -SPHERE_RADIUS / Math.sqrt(dist2);
        offsets[i * 3] = ox * inv * (0.7 + Math.random() * 0.6);
        offsets[i * 3 + 1] = oy * inv * (0.7 + Math.random() * 0.6);
        offsets[i * 3 + 2] = oz * inv * (0.7 + Math.random() * 0.6);
      }

      pos[i * 3] = camera.position.x + r32(offsets, i * 3);
      pos[i * 3 + 1] = camera.position.y + r32(offsets, i * 3 + 1);
      pos[i * 3 + 2] = camera.position.z + r32(offsets, i * 3 + 2);
    }

    ref.current.geometry.attributes["position"]!.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.08}
        color="#b0c8ff"
        transparent
        opacity={0.45}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
};
