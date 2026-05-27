/**
 * markerLayerStore — thin bridge that lets MarkerLayer (inside the R3F
 * canvas) publish its subsampling state to DOM-level HUD elements that
 * live outside the canvas context.
 *
 * Only the latest counts are stored; no history is needed.
 */
import { create } from "zustand";

interface MarkerLayerState {
  /** Total markers that pass the visibility filter (before subsampling). */
  totalVisible: number;
  /** Markers actually rendered after subsampling. 0 when no data. */
  renderedCount: number;
  /** True when rendered < totalVisible (i.e., subsampling is active). */
  isSubsampled: boolean;
  setSubsampleState: (total: number, rendered: number) => void;
  clear: () => void;
}

export const useMarkerLayerStore = create<MarkerLayerState>()((set) => ({
  totalVisible: 0,
  renderedCount: 0,
  isSubsampled: false,
  setSubsampleState: (total, rendered) =>
    set({ totalVisible: total, renderedCount: rendered, isSubsampled: rendered < total }),
  clear: () => set({ totalVisible: 0, renderedCount: 0, isSubsampled: false }),
}));
