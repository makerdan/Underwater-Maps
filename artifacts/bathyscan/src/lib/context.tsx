import React, { createContext, useContext, useState, ReactNode } from "react";
import type { TerrainData } from "@workspace/api-client-react";

export type AppMode = "fly" | "orbit";

export const SPEEDS = [0.05, 0.15, 0.5, 1.5, 5.0] as const;

interface AppState {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  datasetId: string | null;
  setDatasetId: (id: string | null) => void;
  terrain: TerrainData | null;
  setTerrain: (t: TerrainData | null) => void;
  speedIndex: number;
  setSpeedIndex: (s: number) => void;
  cameraPos: [number, number, number];
  setCameraPos: (p: [number, number, number]) => void;
}

const AppContext = createContext<AppState | null>(null);

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setMode] = useState<AppMode>("fly");
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [terrain, setTerrain] = useState<TerrainData | null>(null);
  const [speedIndex, setSpeedIndex] = useState<number>(1);
  const [cameraPos, setCameraPos] = useState<[number, number, number]>([0, 0, 0]);

  return (
    <AppContext.Provider
      value={{
        mode,
        setMode,
        datasetId,
        setDatasetId,
        terrain,
        setTerrain,
        speedIndex,
        setSpeedIndex,
        cameraPos,
        setCameraPos,
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
