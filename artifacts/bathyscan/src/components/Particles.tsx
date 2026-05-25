import React, { useRef, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useSettingsStore } from "@/lib/settingsStore";

const SPHERE_RADIUS = 30;
const DENSITY_COUNT: Record<string, number> = {
  off: 0,
  sparse: 500,
  dense: 2000,
};

/** Safe typed-array read — noUncheckedIndexedAccess compatible. */
const r32 = (arr: Float32Array, i: number): number => arr[i] ?? 0;

export const Particles: React.FC = () => {
  const { camera } = useThree();
  const ref = useRef<THREE.Points>(null);
  const particleDensity = useSettingsStore((s) => s.particleDensity);
  const reducedMotion = useSettingsStore((s) => s.reducedMotion);

  const count = DENSITY_COUNT[particleDensity] ?? 500;

  const { positions, offsets, velocities } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const offsets = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const rr = SPHERE_RADIUS * Math.cbrt(Math.random());
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      offsets[i * 3] = rr * Math.sin(phi) * Math.cos(theta);
      offsets[i * 3 + 1] = rr * Math.sin(phi) * Math.sin(theta);
      offsets[i * 3 + 2] = rr * Math.cos(phi);

      velocities[i * 3] = (Math.random() - 0.5) * 0.3;
      velocities[i * 3 + 1] = -(0.3 + Math.random() * 0.8);
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.3;

      positions[i * 3] = r32(offsets, i * 3);
      positions[i * 3 + 1] = r32(offsets, i * 3 + 1);
      positions[i * 3 + 2] = r32(offsets, i * 3 + 2);
    }

    return { positions, offsets, velocities };
  }, [count]);

  useFrame((_, delta) => {
    if (!ref.current || count === 0) return;
    const pos = ref.current.geometry.attributes["position"]!.array as Float32Array;
    // Honour the "reduced motion" accessibility preference — keep particles
    // pinned to the camera (so they don't drift off into the world) but skip
    // the per-frame drift integration so the field appears static.
    if (reducedMotion) {
      for (let i = 0; i < count; i++) {
        pos[i * 3] = camera.position.x + r32(offsets, i * 3);
        pos[i * 3 + 1] = camera.position.y + r32(offsets, i * 3 + 1);
        pos[i * 3 + 2] = camera.position.z + r32(offsets, i * 3 + 2);
      }
      ref.current.geometry.attributes["position"]!.needsUpdate = true;
      return;
    }

    for (let i = 0; i < count; i++) {
      offsets[i * 3] = r32(offsets, i * 3) + r32(velocities, i * 3) * delta;
      offsets[i * 3 + 1] = r32(offsets, i * 3 + 1) + r32(velocities, i * 3 + 1) * delta;
      offsets[i * 3 + 2] = r32(offsets, i * 3 + 2) + r32(velocities, i * 3 + 2) * delta;

      const ox = r32(offsets, i * 3);
      const oy = r32(offsets, i * 3 + 1);
      const oz = r32(offsets, i * 3 + 2);
      const dist2 = ox * ox + oy * oy + oz * oz;

      if (dist2 > SPHERE_RADIUS * SPHERE_RADIUS) {
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

  if (count === 0) return null;

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
