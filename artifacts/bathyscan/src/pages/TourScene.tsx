import React, { useEffect, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { MapControls } from "@react-three/drei";
import * as THREE from "three";
import {
  useGetDatasetsIdTerrain,
  getGetDatasetsIdTerrainQueryKey,
} from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { useUiStore } from "@/lib/uiStore";
import { TerrainMesh } from "@/components/TerrainMesh";
import { EfhZoneLayer } from "@/components/EfhZoneLayer";
import { SubstrateLayer } from "@/components/SubstrateLayer";
import { Particles } from "@/components/Particles";
import { Caustics } from "@/components/Caustics";
import { useFlyControls } from "@/hooks/useFlyControls";
import { registerTestThreeCamera } from "@/lib/testHelpers";
import { TidalWaterPlane } from "@/components/TidalWaterPlane";
import { TidalCurrentArrows, type DepthLayer } from "@/components/TidalCurrentArrows";
import { MarkerLayer } from "@/components/MarkerLayer";
import { DepthPoleLayer, DepthPoleDomLabels } from "@/components/DepthPoleLayer";
import { GpsMarker } from "@/components/GpsMarker";
import { DepthProfileLine } from "@/components/DepthProfileLine";
import type { TidalDataResult } from "@/hooks/useTidalData";
import { MAX_DEPTH_WORLD } from "@/lib/terrain";
import { WaterSurfacePlane } from "@/components/WaterSurfacePlane";
import { LandmassMesh } from "@/components/LandmassMesh";
import type { TerrainData } from "@workspace/api-client-react";
import { useSettingsStore } from "@/lib/settingsStore";
import { useDriftStore } from "@/lib/driftStore";
import { DriftWaterPlane } from "@/components/DriftWaterPlane";
import { DriftBoat } from "@/components/DriftBoat";
import { DriftPath } from "@/components/DriftPath";
import { ConditionsOverlays } from "@/components/ConditionsOverlays";
import { CurrentsLayer } from "@/components/CurrentsLayer";
import { useCurrentsStore } from "@/lib/currentsStore";

// ---------------------------------------------------------------------------
// FlyControlsScene — lives inside <Canvas>, wires up controls + lamp
// ---------------------------------------------------------------------------
interface FlyControlsSceneProps {
  terrainMeshRef: React.RefObject<THREE.Mesh | null>;
}

const FlyControlsScene: React.FC<FlyControlsSceneProps> = ({ terrainMeshRef }) => {
  const lightRef = useRef<THREE.PointLight>(null);
  const { mode } = useAppState();
  const paintMode = useUiStore((s) => s.zonePaintMode);
  const { orbitTargetArr } = useFlyControls({ terrainMeshRef, lightRef });
  const lampIntensity = useSettingsStore((s) => s.lampIntensity);
  const lampRange = useSettingsStore((s) => s.lampRange);
  const waterType = useSettingsStore((s) => s.waterType);
  const mouseZoomSensitivity = useSettingsStore((s) => s.mouseZoomSensitivity);
  const touchpadZoomSensitivity = useSettingsStore((s) => s.touchpadZoomSensitivity);
  const orbitControlsRef = useRef<{ zoomSpeed: number } | null>(null);
  const { gl } = useThree();

  // Orbit mode: classify each wheel event (mouse notch vs trackpad swipe) and
  // mutate the live MapControls.zoomSpeed BEFORE MapControls' own wheel handler
  // runs, so touchpad and mouse can be tuned independently. We use the capture
  // phase so we win the race against MapControls' bubble-phase listener.
  useEffect(() => {
    if (mode !== "orbit") return;
    const el = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      const ctrl = orbitControlsRef.current;
      if (!ctrl) return;
      const isTouchpad = e.deltaMode === 0 && Math.abs(e.deltaY) < 50;
      ctrl.zoomSpeed = isTouchpad ? touchpadZoomSensitivity : mouseZoomSensitivity;
    };
    el.addEventListener("wheel", onWheel, { capture: true, passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
    };
  }, [mode, gl.domElement, mouseZoomSensitivity, touchpadZoomSensitivity]);
  // Freshwater lakes carry less particulate than the open ocean, so the
  // submersible lamp reads cooler / less amber than the deep-sea default.
  const lampColor = waterType === "freshwater" ? "#eaffff" : "#fff8e8";

  return (
    <>
      {/* Submersible lamp — colour + intensity driven by water type / user setting */}
      <pointLight
        ref={lightRef}
        color={lampColor}
        intensity={lampIntensity}
        distance={lampRange}
        decay={2}
      />

      {/* Orbit mode: MapControls replaces fly movement.
          Disabled while painting so drag-strokes don't also orbit the camera. */}
      {mode === "orbit" && (
        <MapControls
          ref={orbitControlsRef as unknown as React.Ref<never>}
          target={orbitTargetArr.current}
          enableDamping
          dampingFactor={0.08}
          screenSpacePanning={false}
          enabled={!paintMode}
          zoomSpeed={mouseZoomSensitivity}
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
// Tidal 3D contents — lives inside <Canvas>.
//
// When tidal overlay is on we substitute TidalWaterPlane for the static
// WaterSurfacePlane so the surface visibly rises/falls with the tide.
// Both are gated on `showWaterSurface` so disabling the toggle hides any
// water plane (useful for cross-sections / dry-bathymetry views).
// ---------------------------------------------------------------------------
interface TidalSceneContentsProps {
  tidalData: TidalDataResult | null;
  depthLayer: DepthLayer;
  terrain: TerrainData;
  showWaterSurface: boolean;
}

const TidalSceneContents: React.FC<TidalSceneContentsProps> = ({
  tidalData,
  depthLayer,
  terrain,
  showWaterSurface,
}) => {
  if (!tidalData?.available) return null;

  const surfY = seaSurfaceY(terrain);

  return (
    <>
      {showWaterSurface && (
        <TidalWaterPlane tideHeight={tidalData.tideHeight} terrain={terrain} />
      )}
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
// Currents (Task #136) — reads runtime NOAA ambient via a hook so subscription
// triggers re-renders when the value updates.
// ---------------------------------------------------------------------------
const CurrentsSceneContents: React.FC<{ terrain: TerrainData }> = ({ terrain }) => {
  const noaaAmbient = useCurrentsStore((s) => s.noaaAmbient);
  return <CurrentsLayer terrain={terrain} noaaAmbient={noaaAmbient} />;
};

// ---------------------------------------------------------------------------
// Drift Planner 3D elements — lives inside <Canvas>
// ---------------------------------------------------------------------------
const DriftSceneContents: React.FC = () => {
  const { terrain } = useAppState();
  const { driftPlannerActive, driftPath } = useDriftStore();

  if (!driftPlannerActive || !terrain) return null;

  const surfaceY = seaSurfaceY(terrain);
  return (
    <>
      <DriftWaterPlane surfaceY={surfaceY} terrain={terrain} />
      {driftPath && driftPath.length > 0 && (
        <>
          <DriftBoat surfaceY={surfaceY} />
          <DriftPath surfaceY={surfaceY} />
        </>
      )}
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

// Dev-only: hand the live THREE.PerspectiveCamera to testHelpers so e2e
// tests can read camera.position synchronously after dispatching wheel
// events. Renders nothing in production builds.
const TestCameraBridge: React.FC = () => {
  const { camera } = useThree();
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    registerTestThreeCamera(camera);
    return () => registerTestThreeCamera(null);
  }, [camera]);
  return null;
};

const SceneContents: React.FC<SceneContentsProps> = ({
  terrainMeshRef,
  tidalData,
  tidalOverlay,
  depthLayer,
}) => {
  const { terrain } = useAppState();
  const fogDensity = useSettingsStore((s) => s.fogDensity);
  const fogColor = useSettingsStore((s) => s.fogColor);
  const ambientIntensity = useSettingsStore((s) => s.ambientLightIntensity);
  const directionalIntensity = useSettingsStore((s) => s.directionalLightIntensity);
  const waterType = useSettingsStore((s) => s.waterType);
  const showWaterSurface = useSettingsStore((s) => s.showWaterSurface);
  const showLandmass = useSettingsStore((s) => s.showLandmass);

  // Freshwater environments are clearer and brighter than the open ocean —
  // shift the background/fog hue toward green-teal, thin the fog, and warm
  // the ambient/key lights so lakes don't render with deep-sea twilight.
  const isFresh = waterType === "freshwater";
  const effectiveFogColor = isFresh ? "#0b3a35" : fogColor;
  const effectiveFogDensity = isFresh ? fogDensity * 0.55 : fogDensity;
  const ambientHue = isFresh ? "#a8d8c8" : "#7aa8c8";
  const directionalHue = isFresh ? "#dfffe8" : "#d0eeff";

  return (
    <>
      <color attach="background" args={[effectiveFogColor]} />
      <fogExp2 args={[effectiveFogColor, effectiveFogDensity]} />

      {/* Ambient fill — hue tracks water type */}
      <ambientLight intensity={ambientIntensity} color={ambientHue} />
      {/* Distant key light */}
      <directionalLight position={[10, 30, 20]} intensity={directionalIntensity} color={directionalHue} />

      <TestCameraBridge />
      <Particles />
      {terrain && <TerrainMesh ref={terrainMeshRef} grid={terrain} />}
      {terrain && showLandmass && <LandmassMesh grid={terrain} />}
      <EfhZoneLayer />
      <SubstrateLayer />
      <Caustics />

      {tidalOverlay && terrain ? (
        <TidalSceneContents
          tidalData={tidalData}
          depthLayer={depthLayer}
          terrain={terrain}
          showWaterSurface={showWaterSurface}
        />
      ) : (
        terrain && showWaterSurface && <WaterSurfacePlane terrain={terrain} />
      )}

      {terrain && <CurrentsSceneContents terrain={terrain} />}
      <MarkerLayer />
      <DepthPoleLayer />
      <GpsMarker />
      <DepthProfileLine />
      <FlyControlsScene terrainMeshRef={terrainMeshRef} />
      <DriftSceneContents />
      <ConditionsOverlays />
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

  const fov = useSettingsStore((s) => s.fieldOfView);
  const renderDistance = useSettingsStore((s) => s.renderDistance);
  const antialias = useSettingsStore((s) => s.antialiasing);

  return (
    <div className="relative w-full h-full">
      <Canvas
        camera={{ position: [0, 20, 40], fov, far: renderDistance }}
        gl={{ antialias }}
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
