/**
 * useWaterTypeSideEffects — runs the side-effects that must happen when the
 * user switches between saltwater and freshwater exploration modes:
 *
 *   1. Clears derived state computed for the previous environment
 *      (terrain grids, zone classification, habitat scoring cache).
 *   2. Auto-switches the depth colormap to the mode-appropriate default,
 *      but only if the current theme is the *previous* environment's
 *      default (otherwise the user's explicit choice is respected).
 *   3. Auto-loads the first dataset preset of the new water type.
 *
 * Extracted from App.tsx so it can be exercised in isolation by the
 * vitest suite (see __tests__/waterTypeSwitch.test.tsx).
 */
import { useEffect, useRef } from "react";
import type { DatasetMeta } from "@workspace/api-client-react";
import { useSettingsStore } from "@/lib/settingsStore";
import { useTerrainStore } from "@/lib/terrainStore";
import { useClassificationStore } from "@/lib/classificationStore";
import { useHabitatStore } from "@/lib/habitatStore";
import { requestDatasetSwitch } from "@/lib/simulatedDataStore";

export function useWaterTypeSideEffects(
  datasets: DatasetMeta[] | undefined,
  setDatasetId: (id: string | null) => void,
  onAfterSwitch?: () => void,
): void {
  const waterType = useSettingsStore((s) => s.waterType);
  const prevWaterTypeRef = useRef(waterType);

  useEffect(() => {
    if (prevWaterTypeRef.current === waterType) return;
    const prev = prevWaterTypeRef.current;
    prevWaterTypeRef.current = waterType;

    // Apply the full water-type switch: clear derived state, flip the
    // colormap default, and load the first preset of the new water type.
    // Wrapped so that if the dataset switch is cancelled (synthetic warning),
    // we preserve the previously-active dataset and its derived state.
    function applySwitch(newDatasetId: string | null): void {
      try { useTerrainStore.getState().setGrids({ activeGrid: null, overviewGrid: null }); } catch { /* noop */ }
      try { useClassificationStore.getState().clearZoneMap?.(); } catch { /* noop */ }
      try { useHabitatStore.getState().clear?.(); } catch { /* noop */ }

      try {
        const st = useSettingsStore.getState();
        const currentTheme = st.colormapTheme;
        const prevDefault = prev === "freshwater" ? "freshwater" : "ocean";
        const nextDefault = waterType === "freshwater" ? "freshwater" : "ocean";
        if (currentTheme === prevDefault && currentTheme !== nextDefault) {
          st.setColormapTheme?.(nextDefault);
        }
      } catch { /* noop */ }

      setDatasetId(newDatasetId);
      onAfterSwitch?.();
    }

    const first = (datasets ?? []).find((d) => d.waterType === waterType);
    if (first?.id) {
      void requestDatasetSwitch({
        datasetId: first.id,
        datasetName: first.name,
        onConfirm: () => applySwitch(first.id),
        onCancel: () => {
          // User declined synthetic load — revert water-type setting and
          // leave the previously-active dataset + derived state intact.
          prevWaterTypeRef.current = prev;
          try { useSettingsStore.getState().setWaterType?.(prev); } catch { /* noop */ }
        },
      });
    } else {
      applySwitch(null);
    }
  }, [waterType, datasets, setDatasetId, onAfterSwitch]);
}
