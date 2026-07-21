/**
 * ShallowDatasetBanner — dismissible floating banner shown once per dataset
 * when a shallow dataset (depth range under ~20 ft / 6 m) loads.
 *
 * Suggests increasing vertical exaggeration and switching to a fine contour
 * interval. Clicking APPLY sets both in one step; DISMISS hides the banner
 * for the rest of the session. Settings are never changed automatically.
 */
import React from "react";
import {
  useShallowSuggestion,
  useShallowSuggestionStore,
} from "@/hooks/useShallowSuggestion";
import { useSettingsStore } from "@/lib/settingsStore";
import {
  SHALLOW_SUGGESTED_EXAGGERATION,
  fineContourIntervalFor,
  fineContourIntervalLabel,
} from "@/lib/shallowDataset";

const FONT = "'JetBrains Mono', 'Fira Code', monospace";

export function ShallowDatasetBanner() {
  useShallowSuggestion();

  const suggestionDatasetId = useShallowSuggestionStore(
    (s) => s.suggestionDatasetId,
  );
  const dismiss = useShallowSuggestionStore((s) => s.dismiss);
  const units = useSettingsStore((s) => s.units);

  if (!suggestionDatasetId) return null;

  const intervalLabel = fineContourIntervalLabel(units);

  const handleApply = () => {
    const s = useSettingsStore.getState();
    s.setTerrainExaggeration(SHALLOW_SUGGESTED_EXAGGERATION);
    s.setContourInterval(fineContourIntervalFor(s.units));
    s.setContoursEnabled(true);
    dismiss();
  };

  return (
    <div
      data-testid="shallow-suggestion-banner"
      role="status"
      style={{
        position: "fixed",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 60,
        maxWidth: 560,
        width: "calc(100% - 32px)",
        padding: "12px 14px",
        background: "rgba(2,16,26,0.92)",
        border: "1px solid rgba(0,229,255,0.35)",
        borderRadius: 8,
        fontFamily: FONT,
        boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <div
            style={{
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
              letterSpacing: "0.12em",
              color: "#00e5ff",
              fontWeight: 700,
            }}
          >
            SHALLOW DATASET DETECTED
          </div>
          <div style={{ fontSize: "calc(14.5px * var(--bs-font-scale, 1))", color: "#e2e8f0", marginTop: 3, lineHeight: 1.45 }}>
            This is a shallow dataset. Consider increasing vertical
            exaggeration to {SHALLOW_SUGGESTED_EXAGGERATION}× and switching to{" "}
            {intervalLabel} contours for better detail.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            data-testid="shallow-suggestion-apply"
            onClick={handleApply}
            style={{
              fontFamily: FONT,
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
              letterSpacing: "0.15em",
              padding: "6px 14px",
              background: "rgba(0,229,255,0.12)",
              border: "1px solid rgba(0,229,255,0.4)",
              borderRadius: 4,
              color: "#00e5ff",
              cursor: "pointer",
            }}
          >
            APPLY
          </button>
          <button
            type="button"
            data-testid="shallow-suggestion-dismiss"
            onClick={dismiss}
            aria-label="Dismiss shallow dataset suggestion"
            style={{
              fontFamily: FONT,
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
              letterSpacing: "0.15em",
              padding: "6px 10px",
              background: "transparent",
              border: "1px solid rgba(148,163,184,0.3)",
              borderRadius: 4,
              color: "#94a3b8",
              cursor: "pointer",
            }}
          >
            DISMISS
          </button>
        </div>
      </div>
    </div>
  );
}
