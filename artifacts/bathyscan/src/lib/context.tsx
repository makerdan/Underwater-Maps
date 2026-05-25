import React, { createContext, useContext, useState, ReactNode } from "react";
import type { TerrainData } from "@workspace/api-client-react";
import { BOAT_DEFAULT_MPH, BOAT_MIN_MPH, BOAT_MAX_MPH } from "./boatSpeed";

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
  tidalOverlay: boolean;
  setTidalOverlay: (b: boolean) => void;
  realisticMode: boolean;
  setRealisticMode: (b: boolean) => void;
  boatSpeedMph: number;
  setBoatSpeedMph: (mph: number) => void;
}

const AppContext = createContext<AppState | null>(null);

function readLocalBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

function readLocalNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = parseFloat(raw);
    return isNaN(n) ? fallback : n;
  } catch {
    return fallback;
  }
}

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setMode] = useState<AppMode>("fly");
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [terrain, setTerrain] = useState<TerrainData | null>(null);
  const [speedIndex, setSpeedIndex] = useState<number>(1);
  const [cameraPos, setCameraPos] = useState<[number, number, number]>([0, 0, 0]);

  const [tidalOverlay, setTidalOverlayRaw] = useState<boolean>(() =>
    readLocalBool("bathyscan:tidalOverlay", false),
  );
  const [realisticMode, setRealisticModeRaw] = useState<boolean>(() =>
    readLocalBool("bathyscan:realisticMode", false),
  );
  const [boatSpeedMph, setBoatSpeedMphRaw] = useState<number>(() => {
    const raw = readLocalNumber("bathyscan:boatSpeedMph", BOAT_DEFAULT_MPH);
    return Math.max(BOAT_MIN_MPH, Math.min(BOAT_MAX_MPH, raw));
  });

  function setTidalOverlay(b: boolean) {
    setTidalOverlayRaw(b);
    try { localStorage.setItem("bathyscan:tidalOverlay", String(b)); } catch {}
  }

  function setRealisticMode(b: boolean) {
    setRealisticModeRaw(b);
    try { localStorage.setItem("bathyscan:realisticMode", String(b)); } catch {}
  }

  function setBoatSpeedMph(mph: number) {
    setBoatSpeedMphRaw(mph);
    try { localStorage.setItem("bathyscan:boatSpeedMph", String(mph)); } catch {}
  }

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
        tidalOverlay,
        setTidalOverlay,
        realisticMode,
        setRealisticMode,
        boatSpeedMph,
        setBoatSpeedMph,
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
