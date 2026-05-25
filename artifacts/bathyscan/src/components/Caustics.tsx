import React, { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { WORLD_SIZE } from "@/lib/terrain";
import { useSettingsStore } from "@/lib/settingsStore";

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
varying vec2 vUv;

vec2 hash22(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(vec2(p.x * p.y, p.x + p.y));
}

float voronoi(vec2 uv, float t) {
  vec2 pi = floor(uv);
  vec2 pf = fract(uv);
  float minDist = 1.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 b = vec2(float(x), float(y));
      vec2 o = hash22(pi + b);
      o = 0.5 + 0.5 * sin(t * 0.6 + 6.28318 * o);
      float d = length(b + o - pf);
      minDist = min(minDist, d);
    }
  }
  return minDist;
}

void main() {
  float v = voronoi(vUv * 7.0, uTime);
  float caustic = pow(smoothstep(0.5, 0.0, v), 2.0);
  gl_FragColor = vec4(caustic * 0.5, caustic * 0.85, caustic * 1.1, caustic * 0.08);
}
`;

export const Caustics: React.FC = () => {
  const enabledFromEnv = import.meta.env.VITE_ENABLE_CAUSTICS === "true";
  const enabledFromSettings = useSettingsStore((s) => s.enableCaustics);
  const enabled = enabledFromEnv || enabledFromSettings;
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);

  useFrame((_, delta) => {
    if (materialRef.current) {
      materialRef.current.uniforms["uTime"]!.value += delta;
    }
  });

  if (!enabled) return null;

  return (
    <mesh position={[0, 0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[WORLD_SIZE, WORLD_SIZE]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        transparent
      />
    </mesh>
  );
};
