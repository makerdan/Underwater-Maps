/**
 * clearStaleDefaultMapLoad — shared water-type-switch companion.
 *
 * A preset Default Map Load is water-type specific. After switching
 * exploration mode, if the saved preset doesn't exist in the new mode's
 * preset list, clear it so the Settings picker never shows a blank
 * selection and startup never silently substitutes a different dataset.
 * Uploads and "none" are mode-independent and left untouched.
 *
 * Used by BOTH water-type entry points — the compact HUD toggle
 * (WaterTypeToggle) and the Settings "Exploration Mode" radios
 * (GeneralSection) — so the two switch paths cannot drift apart again.
 * Network failure keeps the stored value rather than destroying it.
 */
import { getDatasets } from "@workspace/api-client-react";
import { useSettingsStore, type WaterType } from "@/lib/settingsStore";

export async function clearStaleDefaultMapLoad(wt: WaterType): Promise<void> {
  const current = useSettingsStore.getState().defaultMapLoad;
  if (current?.kind !== "preset") return;
  try {
    const presets = await getDatasets({ waterType: wt });
    const state = useSettingsStore.getState();
    if (state.waterType !== wt) return; // user switched again mid-flight
    if (
      state.defaultMapLoad?.kind === "preset" &&
      state.defaultMapLoad.id === current.id &&
      !presets.some((p) => p.id === current.id)
    ) {
      state.setDefaultMapLoad(null);
    }
  } catch {
    // Network failure: keep the stored value rather than destroying it.
  }
}
