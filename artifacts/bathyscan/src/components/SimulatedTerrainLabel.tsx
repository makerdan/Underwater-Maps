/**
 * SimulatedTerrainLabel — floating 3D billboard warning rendered over any
 * terrain section whose data source is synthetic (procedurally generated).
 *
 * Rendered by TerrainMesh alongside the mesh itself so every simulated grid
 * (primary, multi-primary secondaries, proximity-streamed) carries its own
 * labels. Uses the same drei <Billboard>/<Text> approach as MarkerSprite so
 * the text always faces the camera and stays legible while flying around.
 */
import React from "react";
import { Billboard, Text } from "@react-three/drei";
import * as THREE from "three";
import { WORLD_SIZE } from "@/lib/terrain";

const LABEL_COLOR = "#f59e0b";
const LABEL_TEXT = "SIMULATED";
const SUB_TEXT = "not real sonar data";

/** Positions (x, z) of the labels across the grid, in world units. */
const LABEL_POSITIONS: Array<[number, number]> = [
  [0, 0],
  [-WORLD_SIZE * 0.3, -WORLD_SIZE * 0.3],
  [WORLD_SIZE * 0.3, WORLD_SIZE * 0.3],
];

export const SimulatedTerrainLabel: React.FC = () => {
  return (
    <group name="simulated-terrain-labels">
      {LABEL_POSITIONS.map(([x, z], i) => (
        <Billboard key={i} position={[x, 3.5, z]}>
          {/* Dark backing plate so the text reads against any terrain colour */}
          <mesh position={[0, -0.35, -0.02]}>
            <planeGeometry args={[i === 0 ? 13 : 9.5, i === 0 ? 3.4 : 2.5]} />
            <meshBasicMaterial
              color="#020818"
              transparent
              opacity={0.55}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
          <Text
            fontSize={i === 0 ? 1.6 : 1.1}
            color={LABEL_COLOR}
            outlineColor="#000000"
            outlineWidth={0.06}
            anchorX="center"
            anchorY="middle"
            letterSpacing={0.15}
          >
            {`⚠ ${LABEL_TEXT}`}
          </Text>
          <Text
            position={[0, i === 0 ? -1.15 : -0.85, 0]}
            fontSize={i === 0 ? 0.7 : 0.5}
            color="#fbbf24"
            outlineColor="#000000"
            outlineWidth={0.04}
            anchorX="center"
            anchorY="middle"
          >
            {SUB_TEXT}
          </Text>
        </Billboard>
      ))}
    </group>
  );
};
