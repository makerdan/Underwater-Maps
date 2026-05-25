import React, { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { WORLD_SIZE, MAX_DEPTH_WORLD } from "@/lib/terrain";
import type { TerrainData } from "@workspace/api-client-react";

export type DepthLayer = "surface" | "mid" | "near-bottom";

interface TidalCurrentArrowsProps {
  currentDirection: number;
  currentSpeed: number;
  surfaceY: number;
  depthLayer: DepthLayer;
  terrain: TerrainData;
}

const GRID_COUNT = 6;
const ARROW_SCALE = 1.2;
const SPEED_SCALE = 3.0;

const LAYER_OFFSETS: Record<DepthLayer, number> = {
  surface: 0,
  mid: -MAX_DEPTH_WORLD * 0.4,
  "near-bottom": -MAX_DEPTH_WORLD * 0.8,
};

const LAYER_SPEED_ATTENUATE: Record<DepthLayer, number> = {
  surface: 1.0,
  mid: 0.6,
  "near-bottom": 0.25,
};

function buildArrowShape(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.5);
  shape.lineTo(0.18, 0.1);
  shape.lineTo(0.08, 0.1);
  shape.lineTo(0.08, -0.5);
  shape.lineTo(-0.08, -0.5);
  shape.lineTo(-0.08, 0.1);
  shape.lineTo(-0.18, 0.1);
  shape.closePath();

  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export const TidalCurrentArrows: React.FC<TidalCurrentArrowsProps> = ({
  currentDirection,
  currentSpeed,
  surfaceY,
  depthLayer,
  terrain,
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const progressRef = useRef<Float32Array>(new Float32Array(GRID_COUNT * GRID_COUNT));
  const basePositions = useRef<Array<[number, number, number]>>([]);

  const count = GRID_COUNT * GRID_COUNT;
  const geometry = useMemo(() => buildArrowShape(), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#38bdf8",
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [],
  );

  const dirRad = useMemo(() => ((270 - currentDirection) * Math.PI) / 180, [currentDirection]);
  const dirVec = useMemo(
    () => new THREE.Vector3(Math.cos(dirRad), 0, -Math.sin(dirRad)).normalize(),
    [dirRad],
  );

  const yOffset = LAYER_OFFSETS[depthLayer] ?? 0;
  const attenuate = LAYER_SPEED_ATTENUATE[depthLayer] ?? 1.0;

  useEffect(() => {
    const depthRange = (terrain.maxDepth - terrain.minDepth) || 1;
    const seaSurfaceY = (terrain.minDepth / depthRange) * MAX_DEPTH_WORLD;
    const baseY = seaSurfaceY + yOffset;
    const spacing = WORLD_SIZE / (GRID_COUNT + 1);
    const positions: Array<[number, number, number]> = [];

    for (let row = 0; row < GRID_COUNT; row++) {
      for (let col = 0; col < GRID_COUNT; col++) {
        const x = -WORLD_SIZE / 2 + spacing * (col + 1);
        const z = -WORLD_SIZE / 2 + spacing * (row + 1);
        positions.push([x, baseY, z]);
      }
    }
    basePositions.current = positions;

    progressRef.current = new Float32Array(count).map(() => Math.random());
  }, [terrain, yOffset, count]);

  const slackLerpRef = useRef(0);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const SLACK_THRESHOLD = 0.1;
    const slackTarget = currentSpeed < SLACK_THRESHOLD ? 1 : 0;
    slackLerpRef.current += (slackTarget - slackLerpRef.current) * Math.min(1, delta * 1.5);
    const slackBlend = slackLerpRef.current;

    const baseSpeed = currentSpeed * attenuate * SPEED_SCALE;
    const speed = baseSpeed * (1 - slackBlend);
    const opacityScale = 1 - slackBlend * 0.7; // fade to ~30% during slack
    const dummy = new THREE.Object3D();
    const yaw = -dirRad;

    material.opacity = 0.75 * opacityScale;

    for (let i = 0; i < count; i++) {
      const base = basePositions.current[i];
      if (!base) continue;

      progressRef.current[i] = ((progressRef.current[i] ?? 0) + delta * speed * 0.1) % 1;
      const t = progressRef.current[i] ?? 0;

      const travel = (t - 0.5) * (WORLD_SIZE / GRID_COUNT);
      const x = base[0] + dirVec.x * travel;
      const z = base[2] + dirVec.z * travel;
      const opacity = 0.4 + 0.6 * Math.sin(t * Math.PI);
      const scale = ARROW_SCALE * opacity * (1 - slackBlend * 0.4);

      dummy.position.set(x, surfaceY + yOffset, z);
      dummy.rotation.y = yaw;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, count]}
      renderOrder={3}
    />
  );
};
