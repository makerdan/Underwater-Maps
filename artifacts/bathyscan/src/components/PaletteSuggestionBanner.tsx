/**
 * PaletteSuggestionBanner — inline banner that appears in the Settings
 * "Depth Display" section when the suggestion engine has a better colormap
 * for the currently loaded dataset.
 *
 * Shown only when:
 *   - A dataset is loaded (activeGrid is non-null)
 *   - The user has a manually-set palette (colormapUserSet === true)
 *   - The suggestion differs from the current theme
 *   - The user has not dismissed this specific dataset's suggestion this session
 */
import React from "react";
import { usePaletteSuggestionStore } from "@/hooks/usePaletteSuggestion";
import { useSettingsStore } from "@/lib/settingsStore";
import { usePaletteStore } from "@/lib/paletteStore";
import { colormapCssGradient } from "@/lib/colormap";
import type { ColormapTheme } from "@/lib/settingsStore";

const FONT = "'JetBrains Mono', 'Fira Code', monospace";

const THEME_LABELS: Record<ColormapTheme, string> = {
  ocean: "Ocean (blue)",
  freshwater: "Freshwater (green)",
  thermal: "Thermal (purple→white)",
  grayscale: "Grayscale",
  viridis: "Viridis (purple→yellow)",
  custom: "Custom",
};

export function PaletteSuggestionBanner() {
  const suggestion = usePaletteSuggestionStore((s) => s.suggestion);
  const suggestionDatasetId = usePaletteSuggestionStore((s) => s.suggestionDatasetId);
  // Subscribe to the dismissed-set itself (not just the isDismissed helper):
  // dismiss() only mutates dismissedDatasetIds, so without this subscription
  // the component never re-renders after a dismissal and the banner stays
  // visible until some unrelated parent render happens to rescue it.
  const dismissedDatasetIds = usePaletteSuggestionStore((s) => s.dismissedDatasetIds);
  const dismiss = usePaletteSuggestionStore((s) => s.dismiss);
  const currentTheme = useSettingsStore((s) => s.colormapTheme);
  const setColormapThemeByUser = useSettingsStore((s) => s.setColormapThemeByUser);
  const setBandBoundaries = usePaletteStore((s) => s.setBandBoundaries);

  if (
    !suggestion ||
    (suggestionDatasetId !== null && dismissedDatasetIds.has(suggestionDatasetId)) ||
    suggestion.theme === currentTheme
  ) {
    return null;
  }

  const gradient = colormapCssGradient(suggestion.theme, "to right", 16);

  const handleApply = () => {
    setColormapThemeByUser(suggestion.theme);
    setBandBoundaries(suggestion.bandBoundaries);
    dismiss();
  };

  return (
    <div
      data-testid="palette-suggestion-banner"
      style={{
        margin: "0 0 12px 0",
        padding: "12px 14px",
        background: "rgba(0,229,255,0.06)",
        border: "1px solid rgba(0,229,255,0.25)",
        borderRadius: 8,
        fontFamily: FONT,
      }}
    >
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
          <span
            role="img"
            aria-label={`${suggestion.theme} colormap preview`}
            style={{
              display: "inline-block",
              width: 64,
              height: 14,
              background: gradient,
              borderRadius: 3,
              border: "1px solid rgba(0,229,255,0.2)",
              flexShrink: 0,
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, letterSpacing: "0.12em", color: "#00e5ff", fontWeight: 700 }}>
              SUGGESTED PALETTE
            </div>
            <div style={{
              fontSize: 15,
              color: "#e2e8f0",
              marginTop: 2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}>
              {THEME_LABELS[suggestion.theme]}
            </div>
            <div style={{ fontSize: 13.5, color: "#94a3b8", marginTop: 2, letterSpacing: "0.05em" }}>
              {suggestion.reason === "freshwater"
                ? "Freshwater body detected — optimised for lake & river data"
                : "Best match for loaded dataset depth range"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            data-testid="palette-suggestion-apply"
            onClick={handleApply}
            style={{
              fontFamily: FONT,
              fontSize: 13.5,
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
            data-testid="palette-suggestion-dismiss"
            onClick={dismiss}
            style={{
              fontFamily: FONT,
              fontSize: 13.5,
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
