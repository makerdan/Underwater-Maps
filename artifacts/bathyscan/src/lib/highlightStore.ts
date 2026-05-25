/**
 * highlightStore — Zustand store for the terrain highlight overlay.
 *
 * When mode !== 'none', the terrain shader dims all cells outside the highlight
 * range to 30% brightness and tints matching cells cyan.
 *
 * Clear on Escape is handled in App.tsx and QueryPanel.tsx.
 */
import { create } from "zustand";

export type HighlightMode = "none" | "depthRange" | "slope" | "zone";

export interface HighlightParams {
  /** depthRange: minMetres. slope: minDegrees. zone: slot index (0–3). */
  min: number;
  /** depthRange: maxMetres. slope: maxDegrees. unused for zone. */
  max: number;
  /** Zone name (display only). */
  zoneName?: string;
}

interface HighlightStore {
  mode: HighlightMode;
  params: HighlightParams;
  setHighlight: (mode: HighlightMode, params: HighlightParams) => void;
  clearHighlight: () => void;
}

export const useHighlightStore = create<HighlightStore>((set) => ({
  mode: "none",
  params: { min: 0, max: 0 },
  setHighlight: (mode, params) => set({ mode, params }),
  clearHighlight: () => set({ mode: "none", params: { min: 0, max: 0 } }),
}));
