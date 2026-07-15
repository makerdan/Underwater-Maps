/**
 * WaterTempVolumeLayer — semi-transparent 3D water volume coloured by temperature.
 *
 * Renders a BoxGeometry spanning [seafloorY, surfY] in world space with a
 * custom ShaderMaterial that samples a 1×N DataTexture by normalised Y
 * position, mapping warm-at-surface to red/orange and cold-at-depth to
 * blue/purple. Gives users an immediate visual sense of the thermocline
 * without leaving the 3D view.
 *
 * Rendering notes:
 * - THREE.BackSide: visible from inside the water volume looking around.
 * - depthWrite: false — doesn't occlude the terrain.
 * - transparent + low opacity (~0.15) — soft, additive tint over the scene.
 * - renderOrder 1 — behind the water surface plane (renderOrder 2).
 * - Visibility is gated by useFrame (same as WaterSurfacePlane) so the
 *   volume hides when the camera rises above the surface.
 */
import React, { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { WORLD_SIZE } from "@/lib/terrain";

const vertexShader = /* glsl */ `
  varying float vNormY;

  uniform float uSurfY;
  uniform float uSeafloorY;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    float span = uSurfY - uSeafloorY;
    vNormY = span > 0.0 ? clamp((worldPos.y - uSeafloorY) / span, 0.0, 1.0) : 0.5;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const fragmentShader = /* glsl */ `
  varying float vNormY;
  uniform sampler2D uTempTex;
  uniform float uOpacity;

  void main() {
    // vNormY=1 is surface (warm), vNormY=0 is seafloor (cold).
    // Texture row 0 = warmest sample (shallow), row N-1 = coldest (deep).
    // Map surface→texCoord 0, seafloor→texCoord 1.
    float texY = 1.0 - vNormY;
    vec4 col = texture2D(uTempTex, vec2(0.5, texY));
    gl_FragColor = vec4(col.rgb, uOpacity);
  }
`;

interface WaterTempVolumeLayerProps {
  /** World Y of the sea surface (from seaSurfaceY helper). */
  surfY: number;
  /** World Y of the seafloor bottom (typically -MAX_DEPTH_WORLD). */
  seafloorY: number;
  /** Baked 1×N temperature DataTexture from useWaterTempTexture. */
  dataTexture: THREE.DataTexture;
}

export const WaterTempVolumeLayer: React.FC<WaterTempVolumeLayerProps> = ({
  surfY,
  seafloorY,
  dataTexture,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);

  const height = Math.max(0.1, surfY - seafloorY);
  const centerY = (surfY + seafloorY) / 2;

  const geometry = useMemo(() => {
    return new THREE.BoxGeometry(WORLD_SIZE * 1.1, height, WORLD_SIZE * 1.1);
  }, [height]);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTempTex:   { value: dataTexture },
        uOpacity:   { value: 0.15 },
        uSurfY:     { value: surfY },
        uSeafloorY: { value: seafloorY },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
    });
  }, [dataTexture, surfY, seafloorY]);

  useEffect(() => {
    if (material.uniforms["uTempTex"]) {
      material.uniforms["uTempTex"]!.value = dataTexture;
    }
  }, [dataTexture, material]);

  useEffect(() => {
    if (material.uniforms["uSurfY"]) {
      material.uniforms["uSurfY"]!.value = surfY;
    }
    if (material.uniforms["uSeafloorY"]) {
      material.uniforms["uSeafloorY"]!.value = seafloorY;
    }
  }, [surfY, seafloorY, material]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame(({ camera }) => {
    if (meshRef.current) {
      meshRef.current.visible = camera.position.y < surfY + 0.5;
    }
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      position={[0, centerY, 0]}
      renderOrder={1}
      data-testid="water-temp-volume-layer"
    />
  );
};
