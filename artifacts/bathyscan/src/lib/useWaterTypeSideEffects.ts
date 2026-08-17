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
import { useQueryClient } from "@tanstack/react-query";
import { getGetDatasetsMySavesQueryKey, type DatasetMeta } from "@workspace/api-client-react";
import { useSettingsStore } from "@/lib/settingsStore";
import { useTerrainStore } from "@/lib/terrainStore";
import { useClassificationStore } from "@/lib/classificationStore";
import { useHabitatStore } from "@/lib/habitatStore";
import { requestDatasetSwitch } from "@/lib/simulatedDataStore";

export function useWaterTypeSideEffects(
  datasets: DatasetMeta[] | undefined,
  setDatasetId: (id: string | null) => void,
  onAfterSwitch?: () => void,
  onBeforeSwitch?: () => void,
): void {
  const waterType = useSettingsStore((s) => s.waterType);
  const prevWaterTypeRef = useRef(waterType);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (prevWaterTypeRef.current === waterType) return;
    const prev = prevWaterTypeRef.current;
    prevWaterTypeRef.current = waterType;

    // Re-fetch My Library saves for the new mode immediately (the my-saves
    // query key includes waterType, so this prefix invalidation covers every
    // cached slot instead of waiting for the next poll interval).
    void queryClient.invalidateQueries({ queryKey: getGetDatasetsMySavesQueryKey() });

    // Apply the full water-type switch: clear derived state, flip the
    // colormap default, and load the first preset of the new water type.
    // Wrapped so that if the dataset switch is cancelled (synthetic warning),
    // we preserve the previously-active dataset and its derived state.
    // The teardown here only runs on a CONFIRMED switch — the cancel path
    // never reaches applySwitch, so a dismissed dialog leaves the old
    // dataset and its derived state fully intact.
    function applySwitch(newDatasetId: string | null): void {
      // Unmount the previous environment's dataset FIRST, before the new
      // dataset id is committed, so no stale mesh (e.g. the pre-loaded Lake
      // Ray Roberts demo) remains visible while — or after, if no preset of
      // the new water type exists — the replacement loads.
      //   1) onBeforeSwitch lets App.tsx synchronously null its React-level
      //      terrain + datasetId state (the 3-D mesh source of truth).
      //   2) terrainStore.clear() empties visibleDatasets, which also drives
      //      the App bridge that clears context terrain when nothing is visible.
      try { onBeforeSwitch?.(); } catch { /* noop */ }
      try { useTerrainStore.getState().clear(); } catch { /* noop */ }
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
      }).then((accepted) => {
        // Only an explicit `false` means the request was dropped — treat
        // anything else (true, or undefined from legacy stubs) as handled.
        if (accepted !== false) return;
        // Dropped by the in-flight guard: another dataset switch was already
        // resolving, so neither callback will ever fire — no teardown, no
        // auto-load. Revert the mode like a cancel; otherwise badges, My
        // Saves filtering, and the toggle would flip to the new mode while
        // the scene stayed in the previous environment (half-applied state).
        const st = useSettingsStore.getState();
        if (st.waterType !== waterType) return; // user already switched again
        prevWaterTypeRef.current = prev;
        try { st.setWaterType?.(prev); } catch { /* noop */ }
      });
    } else {
      applySwitch(null);
    }
  }, [waterType, datasets, setDatasetId, onAfterSwitch, onBeforeSwitch, queryClient]);
}
