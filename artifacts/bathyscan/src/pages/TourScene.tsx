import React, { useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useGetDatasetsIdTerrain, getGetDatasetsIdTerrainQueryKey } from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { TerrainMesh } from "@/components/TerrainMesh";

// ---------------------------------------------------------------------------
// Marine-snow particle system
// ---------------------------------------------------------------------------
const PARTICLE_COUNT = 400;

const Particles: React.FC = () => {
  const ref = useRef<THREE.Points>(null);
  const positions = React.useMemo(() => {
    const arr = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      arr[i * 3]     = (Math.random() - 0.5) * 120;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 60;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 120;
    }
    return arr;
  }, []);

  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.position.y -= delta * 0.4;
      if (ref.current.position.y < -30) ref.current.position.y = 20;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.12} color="#c8e8ff" transparent opacity={0.25} sizeAttenuation />
    </points>
  );
};

// ---------------------------------------------------------------------------
// Tracks camera world position into app context each frame
// ---------------------------------------------------------------------------
const CameraTracker: React.FC = () => {
  const { camera } = useThree();
  const { setCameraPos } = useAppState();

  useFrame(() => {
    setCameraPos([camera.position.x, camera.position.y, camera.position.z]);
  });

  return null;
};

// ---------------------------------------------------------------------------
// Inner scene — lives inside <Canvas>
// ---------------------------------------------------------------------------
const SceneContents: React.FC = () => {
  const { terrain } = useAppState();

  return (
    <>
      <color attach="background" args={["#040810"]} />
      <fogExp2 args={["#060c1a", 0.015]} />

      {/* Dim blue-tinted ambient */}
      <ambientLight intensity={0.06} color="#8ab4d4" />
      {/* Key light above-forward */}
      <directionalLight position={[10, 30, 20]} intensity={0.5} color="#ffffff" />

      <Particles />
      {terrain && <TerrainMesh grid={terrain} />}

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        minPolarAngle={0}
        maxPolarAngle={Math.PI / 2}
        target={[0, -10, 0]}
      />
      <CameraTracker />
    </>
  );
};

// ---------------------------------------------------------------------------
// Loading overlay
// ---------------------------------------------------------------------------
const LoadingOverlay: React.FC = () => (
  <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#040810]">
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
  <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#040810]">
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

  const { data, isLoading, isError, error, refetch } = useGetDatasetsIdTerrain(
    effectiveId,
    undefined,
    { query: { enabled: !!effectiveId, queryKey: getGetDatasetsIdTerrainQueryKey(effectiveId) } },
  );

  useEffect(() => {
    if (data) setTerrain(data);
  }, [data, setTerrain]);

  return (
    <div className="relative w-full h-full">
      {/* Always-present Canvas so fog/background renders immediately */}
      <Canvas
        camera={{ position: [0, 45, 75], fov: 50 }}
        gl={{ antialias: true }}
        style={{ width: "100%", height: "100%" }}
      >
        <SceneContents />
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
