import React, { createContext, useCallback, useContext, useState, ReactNode } from "react";
import type { TerrainData } from "@workspace/api-client-react";
import { FLY_DEFAULT_SPEED_TIER, FLY_SPEEDS_MPH } from "./boatSpeed";
import { useDriveBoatStore } from "./driveBoatStore";

export { FLY_DEFAULT_SPEED_TIER, FLY_SPEEDS_MPH };

interface AppState {
  datasetId: string | null;
  setDatasetId: (id: string | null) => void;
  terrain: TerrainData | null;
  setTerrain: (t: TerrainData | null) => void;
  speedIndex: number;
  setSpeedIndex: (s: number) => void;
  cameraPos: [number, number, number];
  setCameraPos: (p: [number, number, number]) => void;
  tidalOverlay: boolean;
  setTidalOverlay: (b: boolean) => void;
  /**
   * Test-only: when set (non-null), overrides the live useTidalData result
   * in App.tsx. Allows E2E tests to inject tidal data without waiting for a
   * real (or mocked) HTTP fetch to complete.  Always null in production; the
   * TestBridge sets it via registerTestBridge → feedTidalData.
   */
  tidalDataOverride: unknown;
  setTidalDataOverride: (data: unknown) => void;
  /**
   * Whether Drive Boat (realistic mode) is active.
   * Backed by driveBoatStore so performSignOutCleanup can reset it without a
   * page reload when the user signs out.
   */
  realisticMode: boolean;
  setRealisticMode: (b: boolean) => void;
  /**
   * Target boat speed in mph for Drive Boat mode.
   * Backed by driveBoatStore so performSignOutCleanup can reset it without a
   * page reload when the user signs out.
   */
  boatSpeedMph: number;
  setBoatSpeedMph: (mph: number) => void;
  // Cross-panel handoff: when FindDataPanel materializes a catalog save into
  // the user's dataset library, it writes the new custom_datasets UUID here.
  // DatasetPanel watches this field and routes the load through its
  // /user/datasets/:id/{terrain,overview} flow, then clears the value.
  pendingExternalUserDatasetId: string | null;
  setPendingExternalUserDatasetId: (id: string | null) => void;
  /**
   * Creation date for the most-recently loaded catalog entry, keyed by the dataset ID
   * it came from. Only display when `forDatasetId` matches the active `terrain.datasetId`
   * to prevent stale dates leaking across dataset switches.
   */
  catalogSourcedAt: { forDatasetId: string; date: string | null } | null;
  setCatalogSourcedAt: (entry: { forDatasetId: string; date: string | null } | null) => void;
}

const AppContext = createContext<AppState | null>(null);

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [terrain, setTerrain] = useState<TerrainData | null>(null);
  const [speedIndex, setSpeedIndex] = useState<number>(FLY_DEFAULT_SPEED_TIER);
  const [cameraPos, setCameraPos] = useState<[number, number, number]>([0, 0, 0]);

  const [tidalOverlay, setTidalOverlayRaw] = useState<boolean>(false);
  const [tidalDataOverride, setTidalDataOverride] = useState<unknown>(null);

  // realisticMode and boatSpeedMph are backed by driveBoatStore so that
  // performSignOutCleanup (signoutCleanup.ts) can reset them synchronously on
  // sign-out without requiring a page reload.  The useAppState() API is
  // unchanged: consumers still call setRealisticMode / setBoatSpeedMph as
  // before; driveBoatStore handles localStorage persistence.
  const realisticMode = useDriveBoatStore((s) => s.realisticMode);
  const setRealisticMode = useDriveBoatStore((s) => s.setRealisticMode);
  const boatSpeedMph = useDriveBoatStore((s) => s.boatSpeedMph);
  const setBoatSpeedMph = useDriveBoatStore((s) => s.setBoatSpeedMph);

  const [pendingExternalUserDatasetId, setPendingExternalUserDatasetId] =
    useState<string | null>(null);
  const [catalogSourcedAt, setCatalogSourcedAt] = useState<{ forDatasetId: string; date: string | null } | null>(null);

  const setTidalOverlay = useCallback((b: boolean) => {
    setTidalOverlayRaw(b);
  }, []);

  return (
    <AppContext.Provider
      value={{
        datasetId,
        setDatasetId,
        terrain,
        setTerrain,
        speedIndex,
        setSpeedIndex,
        cameraPos,
        setCameraPos,
        tidalOverlay,
        setTidalOverlay,
        tidalDataOverride,
        setTidalDataOverride,
        realisticMode,
        setRealisticMode,
        boatSpeedMph,
        setBoatSpeedMph,
        pendingExternalUserDatasetId,
        setPendingExternalUserDatasetId,
        catalogSourcedAt,
        setCatalogSourcedAt,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useAppState = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppState must be used within AppProvider");
  return ctx;
};
