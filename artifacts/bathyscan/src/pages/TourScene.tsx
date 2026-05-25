import React, { useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { MapControls } from "@react-three/drei";
import * as THREE from "three";
import {
  useGetDatasetsIdTerrain,
  getGetDatasetsIdTerrainQueryKey,
} from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { TerrainMesh } from "@/components/TerrainMesh";
import { Particles } from "@/components/Particles";
import { Caustics } from "@/components/Caustics";
import { useFlyControls } from "@/hooks/useFlyControls";
import { TidalWaterPlane } from "@/components/TidalWaterPlane";
import { TidalCurrentArrows, type DepthLayer } from "@/components/TidalCurrentArrows";
import { MarkerLayer } from "@/components/MarkerLayer";
import { DepthPoleLayer, DepthPoleDomLabels } from "@/components/DepthPoleLayer";
import { GpsMarker } from "@/components/GpsMarker";
import type { TidalDataResult } from "@/hooks/useTidalData";
import { MAX_DEPTH_WORLD, WORLD_SIZE } from "@/lib/terrain";
import type { TerrainData } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// FlyControlsScene — lives inside <Canvas>, wires up controls + lamp
// ---------------------------------------------------------------------------
interface FlyControlsSceneProps {
  terrainMeshRef: React.RefObject<THREE.Mesh | null>;
}

const FlyControlsScene: React.FC<FlyControlsSceneProps> = ({ terrainMeshRef }) => {
  const lightRef = useRef<THREE.PointLight>(null);
  const { mode } = useAppState();
  const { orbitTargetArr } = useFlyControls({ terrainMeshRef, lightRef });

  return (
    <>
      {/* Submersible lamp — warm white, follows camera forward */}
      <pointLight
        ref={lightRef}
        color="#fff8e8"
        intensity={2}
        distance={40}
        decay={2}
      />

      {/* Orbit mode: MapControls replaces fly movement */}
      {mode === "orbit" && (
        <MapControls
          target={orbitTargetArr.current}
          enableDamping
          dampingFactor={0.08}
          screenSpacePanning={false}
        />
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// Helper: compute sea surface Y for a given terrain
// ---------------------------------------------------------------------------
function seaSurfaceY(terrain: TerrainData): number {
  const depthRange = (terrain.maxDepth - terrain.minDepth) || 1;
  return (terrain.minDepth / depthRange) * MAX_DEPTH_WORLD;
}

// ---------------------------------------------------------------------------
// Ocean surface transparency plane — anchors depth poles visually
// ---------------------------------------------------------------------------
const OceanSurfacePlane: React.FC = () => {
  const meshRef = React.useRef<THREE.Mesh>(null);
  const { camera } = useThree();

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.visible = camera.position.y < 0;
    }
  });

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <planeGeometry args={[WORLD_SIZE, WORLD_SIZE]} />
      <meshStandardMaterial
        color="#aaddff"
        transparent
        opacity={0.08}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

// ---------------------------------------------------------------------------
// Tidal 3D contents — lives inside <Canvas>
// ---------------------------------------------------------------------------
interface TidalSceneContentsProps {
  tidalData: TidalDataResult | null;
  depthLayer: DepthLayer;
  terrain: TerrainData;
}

const TidalSceneContents: React.FC<TidalSceneContentsProps> = ({
  tidalData,
  depthLayer,
  terrain,
}) => {
  if (!tidalData?.available) return null;

  const surfY = seaSurfaceY(terrain);

  return (
    <>
      <TidalWaterPlane tideHeight={tidalData.tideHeight} terrain={terrain} />
      <TidalCurrentArrows
        currentDirection={tidalData.currentDirection}
        currentSpeed={tidalData.currentSpeed}
        surfaceY={surfY + (tidalData.tideHeight / ((terrain.maxDepth - terrain.minDepth) || 1)) * MAX_DEPTH_WORLD}
        depthLayer={depthLayer}
        terrain={terrain}
      />
    </>
  );
};

// ---------------------------------------------------------------------------
// Inner scene — lives inside <Canvas>
// ---------------------------------------------------------------------------
interface SceneContentsProps {
  terrainMeshRef: React.RefObject<THREE.Mesh | null>;
  tidalData: TidalDataResult | null;
  tidalOverlay: boolean;
  depthLayer: DepthLayer;
}

const SceneContents: React.FC<SceneContentsProps> = ({
  terrainMeshRef,
  tidalData,
  tidalOverlay,
  depthLayer,
}) => {
  const { terrain } = useAppState();

  return (
    <>
      <color attach="background" args={["#020818"]} />
      <fogExp2 args={["#020818", 0.012]} />

      {/* Ambient fill */}
      <ambientLight intensity={0.05} color="#7aa8c8" />
      {/* Distant key light */}
      <directionalLight position={[10, 30, 20]} intensity={0.35} color="#d0eeff" />

      <Particles />
      {terrain && <TerrainMesh ref={terrainMeshRef} grid={terrain} />}
      <Caustics />

      {tidalOverlay && terrain && (
        <TidalSceneContents
          tidalData={tidalData}
          depthLayer={depthLayer}
          terrain={terrain}
        />
      )}

      <OceanSurfacePlane />
      <MarkerLayer />
      <DepthPoleLayer />
      <GpsMarker />
      <FlyControlsScene terrainMeshRef={terrainMeshRef} />
    </>
  );
};

// ---------------------------------------------------------------------------
// Loading overlay
// ---------------------------------------------------------------------------
const LoadingOverlay: React.FC = () => (
  <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#020818]">
    <div className="font-mono text-cyan-400 text-lg tracking-[0.3em] uppercase animate-pulse">
      ▼ Descending...
    </div>
    <div className="font-mono text-cyan-900 text-xs mt-3 tracking-widest uppercase">
      Retrieving bathymetric data
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Error overlay
// ---------------------------------------------------------------------------
interface ErrorOverlayProps {
  message: string;
  onRetry: () => void;
}

const ErrorOverlay: React.FC<ErrorOverlayProps> = ({ message, onRetry }) => (
  <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#020818]">
    <div className="font-mono text-red-400 text-lg tracking-[0.3em] uppercase mb-2">
      ⚠ Signal Lost
    </div>
    <div className="font-mono text-red-700 text-xs tracking-wider mb-6 max-w-xs text-center">
      {message}
    </div>
    <button
      onClick={onRetry}
      className="border border-red-800 text-red-400 font-mono text-xs px-5 py-2 tracking-widest uppercase hover:bg-red-900/20 transition-colors"
    >
      Retry Connection
    </button>
  </div>
);

// ---------------------------------------------------------------------------
// TourScene — the main page
// ---------------------------------------------------------------------------
interface TourSceneProps {
  tidalData?: TidalDataResult | null;
  tidalOverlay?: boolean;
  depthLayer?: DepthLayer;
}

export const TourScene: React.FC<TourSceneProps> = ({
  tidalData = null,
  tidalOverlay = false,
  depthLayer = "surface",
}) => {
  const { datasetId, setTerrain } = useAppState();
  const terrainMeshRef = useRef<THREE.Mesh>(null);

  const { data, isLoading, isError, error, refetch } = useGetDatasetsIdTerrain(
    datasetId ?? "",
    undefined,
    {
      query: {
        enabled: !!datasetId,
        queryKey: getGetDatasetsIdTerrainQueryKey(datasetId ?? ""),
      },
    },
  );

  useEffect(() => {
    if (data) setTerrain(data);
  }, [data, setTerrain]);

  return (
    <div className="relative w-full h-full">
      <Canvas
        camera={{ position: [0, 20, 40], fov: 60 }}
        gl={{ antialias: true }}
        style={{ width: "100%", height: "100%" }}
      >
        <SceneContents
          terrainMeshRef={terrainMeshRef}
          tidalData={tidalData}
          tidalOverlay={tidalOverlay}
          depthLayer={depthLayer}
        />
      </Canvas>

      {isLoading && !data && <LoadingOverlay />}
      {isError && (
        <ErrorOverlay
          message={error instanceof Error ? error.message : "Could not load terrain"}
          onRetry={() => void refetch()}
        />
      )}

      {/* Hidden DOM labels for depth-pole markers (E2E testing + accessibility) */}
      <DepthPoleDomLabels />
    </div>
  );
};
