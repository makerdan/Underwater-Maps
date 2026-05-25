import React, { useEffect, useRef } from "react";
import { Canvas } from "@react-three/fiber";
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
// Inner scene — lives inside <Canvas>
// ---------------------------------------------------------------------------
const SceneContents: React.FC<{ terrainMeshRef: React.RefObject<THREE.Mesh | null> }> = ({
  terrainMeshRef,
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
export const TourScene: React.FC = () => {
  const { datasetId, setTerrain } = useAppState();
  const effectiveId = datasetId ?? "mariana-trench";
  const terrainMeshRef = useRef<THREE.Mesh>(null);

  const { data, isLoading, isError, error, refetch } = useGetDatasetsIdTerrain(
    effectiveId,
    undefined,
    {
      query: {
        enabled: !!effectiveId,
        queryKey: getGetDatasetsIdTerrainQueryKey(effectiveId),
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
        <SceneContents terrainMeshRef={terrainMeshRef} />
      </Canvas>

      {isLoading && !data && <LoadingOverlay />}
      {isError && (
        <ErrorOverlay
          message={error instanceof Error ? error.message : "Could not load terrain"}
          onRetry={() => void refetch()}
        />
      )}
    </div>
  );
};
