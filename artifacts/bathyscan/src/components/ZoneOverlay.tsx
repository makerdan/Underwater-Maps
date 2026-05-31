/**
 * ZoneOverlay — AI seafloor classification status badge and zone legend.
 *
 * Shows:
 *  • A pulsing "Analysing terrain…" indicator while classification is running.
 *  • A toggle button to enable/disable the zone colour overlay on the mesh.
 *  • A compact legend listing ALL 8 AI zone labels with their shader-slot colours.
 *
 * Rendered as a DOM overlay (pointer-events: auto) positioned in the HUD.
 * The actual shader tinting is driven by uiStore.zoneOverlayEnabled which
 * TerrainMesh reads every frame via useUiStore.getState().
 */
import React, { useEffect } from "react";
import { useClassificationStore } from "@/lib/classificationStore";
import { useUiStore } from "@/lib/uiStore";
import { useZoneOverlayStore } from "@/lib/zoneOverlayStore";
import { HelpIcon } from "@/components/help/HelpButton";
import { useAppState } from "@/lib/context";
import { usePanelCollapseStore } from "@/lib/panelCollapseStore";
import {
  SALTWATER_ZONES,
  FRESHWATER_ZONES,
  SALTWATER_ZONE_TO_SLOT,
  FRESHWATER_ZONE_TO_SLOT,
  SLOT_NAMES_SALTWATER,
  SLOT_NAMES_FRESHWATER,
} from "@/lib/zoneMap";

/** Human-readable label for a raw zone key. */
function formatZoneLabel(key: string): string {
  return key.replace(/_/g, " ");
}

const PANEL: React.CSSProperties = {
  background: "rgba(2,8,18,0.94)",
  border: "1px solid rgba(0,229,255,0.28)",
  borderRadius: 6,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  color: "#e2e8f0",
  fontSize: 12,
  backdropFilter: "blur(6px)",
  pointerEvents: "auto",
  minWidth: 200,
  maxWidth: 240,
};

const CYAN: React.CSSProperties = {
  color: "#00e5ff",
  textShadow: "0 0 6px rgba(0,229,255,0.5)",
};

interface ZoneOverlayProps {
  embedded?: boolean;
}

export const ZoneOverlay: React.FC<ZoneOverlayProps> = ({ embedded = false }) => {
  const { terrain } = useAppState();
  const loading = useClassificationStore((s) => s.loading);
  const zoneMap = useClassificationStore((s) => s.zoneMap);
  const error = useClassificationStore((s) => s.error);
  const source = useClassificationStore((s) => s.source);
  const classify = useClassificationStore((s) => s.classify);
  const overlayEnabled = useUiStore((s) => s.zoneOverlayEnabled);
  const setOverlayEnabled = useUiStore((s) => s.setZoneOverlayEnabled);
  const paintMode = useUiStore((s) => s.zonePaintMode);
  const setPaintMode = useUiStore((s) => s.setZonePaintMode);
  const paintSlot = useUiStore((s) => s.zonePaintSlot);
  const setPaintSlot = useUiStore((s) => s.setZonePaintSlot);
  const brushRadius = useUiStore((s) => s.zonePaintBrushRadius);
  const setBrushRadius = useUiStore((s) => s.setZonePaintBrushRadius);
  const hasEdits = useClassificationStore((s) => s.hasEdits);
  const resetToAi = useClassificationStore((s) => s.resetToAi);
  const undoPaint = useClassificationStore((s) => s.undoPaint);
  const redoPaint = useClassificationStore((s) => s.redoPaint);
  const clearPaintUndoStack = useClassificationStore((s) => s.clearPaintUndoStack);
  const undoCount = useClassificationStore((s) => s.paintUndoStack.length);
  const redoCount = useClassificationStore((s) => s.paintRedoStack.length);
  const canUndo = undoCount > 0;
  const canRedo = redoCount > 0;
  const storeCollapsed = usePanelCollapseStore((s) => s.collapsed.zoneOverlay);
  const collapsed = embedded ? false : storeCollapsed;
  const togglePanel = usePanelCollapseStore((s) => s.toggle);

  // Zone colour store
  const zoneSlots = useZoneOverlayStore((s) => s.slots);
  const setSlotColor = useZoneOverlayStore((s) => s.setSlotColor);
  const setSlotVisible = useZoneOverlayStore((s) => s.setSlotVisible);
  const resetZoneColors = useZoneOverlayStore((s) => s.resetToDefaults);

  // Clear undo stack whenever Paint Mode is turned off — any path (button, overlay toggle, etc.)
  useEffect(() => {
    if (!paintMode) {
      clearPaintUndoStack();
    }
  }, [paintMode, clearPaintUndoStack]);

  // Ctrl+Z / Cmd+Z — undo, Ctrl+Shift+Z / Cmd+Shift+Z — redo, while Paint Mode is active
  useEffect(() => {
    if (!paintMode) return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      // Don't intercept inside text fields / contentEditable elements
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) return;
      if (e.shiftKey) {
        // Redo
        if (useClassificationStore.getState().paintRedoStack.length === 0) return;
        e.preventDefault();
        redoPaint();
      } else {
        // Undo
        if (useClassificationStore.getState().paintUndoStack.length === 0) return;
        e.preventDefault();
        undoPaint();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [paintMode, undoPaint, redoPaint]);

  // Only show this panel when there's a terrain loaded
  if (!terrain) return null;

  const waterType = terrain.waterType as "saltwater" | "freshwater";
  const zones = waterType === "freshwater" ? FRESHWATER_ZONES : SALTWATER_ZONES;
  const zoneToSlot = waterType === "freshwater" ? FRESHWATER_ZONE_TO_SLOT : SALTWATER_ZONE_TO_SLOT;
  const hasZoneMap = !!zoneMap;

  return (
    <div style={embedded ? { width: "100%" } : PANEL}>
      {/* Header — hidden when embedded inside a SidebarSection */}
      {!embedded && (
      <button
        type="button"
        onClick={() => togglePanel("zoneOverlay")}
        aria-expanded={!collapsed}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-white/5 transition-colors"
        style={{
          borderBottom: collapsed ? "none" : "1px solid rgba(0,229,255,0.08)",
          background: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          className="uppercase tracking-widest"
          style={{ fontSize: 11, ...CYAN, fontWeight: 700 }}
        >
          ◈ Zone Analysis
        </span>
        <div className="flex items-center gap-2">
          {loading && (
            <span className="animate-spin" style={{ fontSize: 10, color: "#00e5ff" }}>
              ◌
            </span>
          )}
          {hasZoneMap && !loading && source && (
            <span
              data-testid={`zone-source-badge-${source}`}
              title={
                source === "ai"
                  ? "Zones classified by AI"
                  : "Zones estimated from depth (AI unavailable)"
              }
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.08em",
                padding: "1px 5px",
                borderRadius: 3,
                textTransform: "uppercase",
                color: source === "ai" ? "#00e5ff" : "#fbbf24",
                background:
                  source === "ai" ? "rgba(0,229,255,0.12)" : "rgba(251,191,36,0.12)",
                border:
                  source === "ai"
                    ? "1px solid rgba(0,229,255,0.45)"
                    : "1px solid rgba(251,191,36,0.45)",
              }}
            >
              {source === "ai" ? "AI" : "EST"}
            </span>
          )}
          <HelpIcon articleId="zones-paint-mode" label="Zones and paint mode" />
          <span style={{ fontSize: 24, lineHeight: 1, color: "#cbd5e1" }}>{collapsed ? "▸" : "▾"}</span>
        </div>
      </button>
      )}

      {/* Body */}
      {!collapsed && (
      <div className="px-3 py-2">
        {/* Loading state */}
        {loading && (
          <div style={{ fontSize: 11, color: "#cbd5e1", marginBottom: 6 }}>
            <span className="animate-pulse">Analysing terrain</span>
            <span style={{ color: "#e2e8f0" }}> (3–8 s)</span>
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div
            data-testid="zone-error"
            data-error-category={error.category}
            style={{ fontSize: 11, color: "#fca5a5", marginBottom: 6, lineHeight: 1.4, userSelect: "text" }}
          >
            {error.reason}
          </div>
        )}

        {/* Overlay toggle — only visible when zone map is ready */}
        {hasZoneMap && !loading && (
          <button
            data-testid="zone-toggle"
            aria-pressed={overlayEnabled}
            onClick={() => setOverlayEnabled(!overlayEnabled)}
            className="w-full text-left flex items-center gap-2 mb-2 hover:bg-white/5 rounded transition-colors"
            style={{ cursor: "pointer", padding: "3px 0" }}
          >
            <span
              style={{
                display: "inline-block",
                width: 12,
                height: 12,
                borderRadius: 2,
                border: overlayEnabled ? "1.5px solid #00e5ff" : "1.5px solid #cbd5e1",
                background: overlayEnabled ? "rgba(0,229,255,0.2)" : "transparent",
                flexShrink: 0,
                transition: "all 0.15s",
              }}
            >
              {overlayEnabled && (
                <span
                  style={{
                    display: "block",
                    textAlign: "center",
                    lineHeight: "10px",
                    fontSize: 8,
                    color: "#00e5ff",
                  }}
                >
                  ✓
                </span>
              )}
            </span>
            <span
              style={{
                fontSize: 11,
                color: overlayEnabled ? "#00e5ff" : "#cbd5e1",
                transition: "color 0.15s",
              }}
            >
              Show zone colours
            </span>
          </button>
        )}

        {/* Heuristic provenance — shown when AI was unavailable */}
        {hasZoneMap && !loading && source === "heuristic" && (
          <div
            data-testid="zone-source-heuristic"
            style={{
              marginBottom: 6,
              padding: "4px 6px",
              border: "1px solid rgba(251,191,36,0.35)",
              borderRadius: 3,
              background: "rgba(251,191,36,0.06)",
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: "#fbbf24",
                letterSpacing: "0.04em",
                lineHeight: 1.4,
              }}
            >
              Estimated from depth (AI unavailable). These zones are a depth-based guess, not an AI classification.
            </div>
            <button
              type="button"
              data-testid="zone-retry-ai"
              onClick={() => {
                if (terrain) void classify(terrain);
              }}
              style={{
                marginTop: 5,
                fontSize: 10,
                color: "#fbbf24",
                background: "transparent",
                border: "1px solid rgba(251,191,36,0.5)",
                borderRadius: 3,
                padding: "2px 8px",
                cursor: "pointer",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              ↻ Retry AI classification
            </button>
          </div>
        )}

        {/* Zone legend — all 8 AI zone labels with their shader-slot colour */}
        {hasZoneMap && !loading && (
          <div className="zone-legend" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {zones.map((zone, i) => {
              const slot = zoneToSlot[i] ?? 0;
              const slotColor = zoneSlots[slot]?.color ?? "#f5d58a";
              return (
                <div key={zone} className="flex items-center gap-2">
                  <span
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: slotColor,
                      flexShrink: 0,
                      opacity: overlayEnabled ? 1 : 0.45,
                      transition: "opacity 0.15s",
                    }}
                  />
                  <span
                    style={{
                      fontSize: 11,
                      color: "#e2e8f0",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {formatZoneLabel(zone)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Zone Colours — colour pickers + per-slot visibility toggles */}
        {/* Always visible when a zone map is loaded; interactions auto-enable the overlay */}
        {hasZoneMap && !loading && (
          <div
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: "1px solid rgba(0,229,255,0.08)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 2,
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: "0.12em",
                  color: "#94a3b8",
                  textTransform: "uppercase",
                }}
              >
                Zone Colours
              </span>
              <button
                data-testid="zone-colors-reset"
                onClick={resetZoneColors}
                style={{
                  fontSize: 9,
                  color: "#64748b",
                  background: "transparent",
                  border: "1px solid rgba(100,116,139,0.3)",
                  borderRadius: 3,
                  padding: "1px 5px",
                  cursor: "pointer",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                Reset
              </button>
            </div>
            {(waterType === "freshwater" ? SLOT_NAMES_FRESHWATER : SLOT_NAMES_SALTWATER).map(
              (name, slotIndex) => {
                const slot = zoneSlots[slotIndex as 0 | 1 | 2 | 3];
                if (!slot) return null;
                const visible = slot.visible;
                return (
                  <div
                    key={slotIndex}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "2px 0",
                    }}
                  >
                    {/* Visibility toggle */}
                    <button
                      data-testid={`zone-slot-visible-${slotIndex}`}
                      aria-pressed={visible}
                      onClick={() => {
                        // Turning any slot back on while the global overlay is off → enable it
                        if (!visible && !overlayEnabled) setOverlayEnabled(true);
                        setSlotVisible(slotIndex as 0 | 1 | 2 | 3, !visible);
                      }}
                      title={visible ? "Hide this zone" : "Show this zone"}
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 2,
                        border: visible
                          ? "1.5px solid rgba(0,229,255,0.5)"
                          : "1.5px solid rgba(100,116,139,0.4)",
                        background: visible ? "rgba(0,229,255,0.12)" : "transparent",
                        cursor: "pointer",
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 0,
                        transition: "all 0.12s",
                      }}
                    >
                      {visible && (
                        <span style={{ fontSize: 8, color: "#00e5ff", lineHeight: 1 }}>✓</span>
                      )}
                    </button>

                    {/* Colour swatch / picker */}
                    <label
                      title="Click to change colour"
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 3,
                        background: slot.color,
                        border: "1px solid rgba(255,255,255,0.15)",
                        cursor: "pointer",
                        flexShrink: 0,
                        display: "inline-block",
                        position: "relative",
                        opacity: visible ? 1 : 0.4,
                        transition: "opacity 0.15s",
                      }}
                    >
                      <input
                        data-testid={`zone-slot-color-${slotIndex}`}
                        type="color"
                        value={slot.color}
                        onChange={(e) => {
                          if (!overlayEnabled) setOverlayEnabled(true);
                          setSlotColor(slotIndex as 0 | 1 | 2 | 3, e.target.value);
                        }}
                        style={{
                          position: "absolute",
                          inset: 0,
                          opacity: 0,
                          cursor: "pointer",
                          width: "100%",
                          height: "100%",
                          border: "none",
                          padding: 0,
                        }}
                      />
                    </label>

                    {/* Slot name */}
                    <span
                      style={{
                        fontSize: 10,
                        color: visible ? "#cbd5e1" : "#475569",
                        letterSpacing: "0.04em",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        transition: "color 0.15s",
                      }}
                    >
                      {name}
                    </span>
                  </div>
                );
              },
            )}
          </div>
        )}

        {/* Paint mode controls — only meaningful when overlay is on */}
        {hasZoneMap && !loading && overlayEnabled && (
          <div
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: "1px solid rgba(0,229,255,0.08)",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <button
              data-testid="zone-paint-toggle"
              aria-pressed={paintMode}
              onClick={() => setPaintMode(!paintMode)}
              className="w-full text-left flex items-center gap-2 hover:bg-white/5 rounded transition-colors"
              style={{ cursor: "pointer", padding: "3px 0" }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 12,
                  height: 12,
                  borderRadius: 2,
                  border: paintMode ? "1.5px solid #00e5ff" : "1.5px solid #cbd5e1",
                  background: paintMode ? "rgba(0,229,255,0.2)" : "transparent",
                  flexShrink: 0,
                  textAlign: "center",
                  lineHeight: "10px",
                  fontSize: 8,
                  color: "#00e5ff",
                }}
              >
                {paintMode ? "✎" : ""}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: paintMode ? "#00e5ff" : "#cbd5e1",
                  transition: "color 0.15s",
                }}
              >
                Paint mode
              </span>
            </button>

            {paintMode && (
              <>
                <div style={{ fontSize: 10, color: "#cbd5e1", letterSpacing: "0.05em" }}>
                  Click &amp; drag on the terrain to repaint
                </div>
                <div
                  data-testid="zone-paint-swatches"
                  style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
                >
                  {([0, 1, 2, 3] as const).map((i) => {
                    const active = paintSlot === i;
                    const slotColor = zoneSlots[i]?.color ?? "#f5d58a";
                    return (
                      <button
                        key={i}
                        data-testid={`zone-paint-swatch-${i}`}
                        aria-label={`Paint slot ${i}`}
                        aria-pressed={active}
                        onClick={() => setPaintSlot(i)}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 4,
                          background: slotColor,
                          cursor: "pointer",
                          border: active
                            ? "2px solid #00e5ff"
                            : "2px solid rgba(255,255,255,0.08)",
                          boxShadow: active ? "0 0 6px rgba(0,229,255,0.6)" : "none",
                          transition: "all 0.12s",
                          padding: 0,
                        }}
                      />
                    );
                  })}
                </div>

                {/* Brush size slider */}
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 10, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      Brush size
                    </span>
                    <span
                      data-testid="zone-brush-radius-value"
                      style={{ fontSize: 10, color: "#00e5ff", fontVariantNumeric: "tabular-nums", minWidth: 18, textAlign: "right" }}
                    >
                      {brushRadius}
                    </span>
                  </div>
                  <input
                    data-testid="zone-brush-radius-slider"
                    type="range"
                    min={1}
                    max={20}
                    value={brushRadius}
                    onChange={(e) => setBrushRadius(Number(e.target.value))}
                    style={{
                      width: "100%",
                      accentColor: "#00e5ff",
                      cursor: "pointer",
                      height: 4,
                    }}
                    aria-label="Brush size"
                  />
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 9, color: "#475569" }}>Fine</span>
                    <span style={{ fontSize: 9, color: "#475569" }}>Broad</span>
                  </div>
                </div>
              </>
            )}

            {paintMode && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    data-testid="zone-undo-paint"
                    onClick={() => undoPaint()}
                    disabled={!canUndo}
                    title="Ctrl+Z / Cmd+Z"
                    style={{
                      fontSize: 11,
                      color: canUndo ? "#cbd5e1" : "#475569",
                      background: "transparent",
                      border: `1px solid ${canUndo ? "rgba(0,229,255,0.28)" : "rgba(100,116,139,0.2)"}`,
                      borderRadius: 3,
                      padding: "4px 6px",
                      cursor: canUndo ? "pointer" : "default",
                      letterSpacing: "0.04em",
                      flex: 1,
                      textAlign: "left",
                      transition: "color 0.15s, border-color 0.15s",
                    }}
                  >
                    ↩ Undo ({undoCount})
                  </button>
                  <button
                    data-testid="zone-redo-paint"
                    onClick={() => redoPaint()}
                    disabled={!canRedo}
                    title="Ctrl+Shift+Z / Cmd+Shift+Z"
                    style={{
                      fontSize: 11,
                      color: canRedo ? "#cbd5e1" : "#475569",
                      background: "transparent",
                      border: `1px solid ${canRedo ? "rgba(0,229,255,0.28)" : "rgba(100,116,139,0.2)"}`,
                      borderRadius: 3,
                      padding: "4px 6px",
                      cursor: canRedo ? "pointer" : "default",
                      letterSpacing: "0.04em",
                      flex: 1,
                      textAlign: "left",
                      transition: "color 0.15s, border-color 0.15s",
                    }}
                  >
                    ↪ Redo ({redoCount})
                  </button>
                </div>
                {hasEdits && (
                  <button
                    data-testid="zone-reset-ai"
                    onClick={() => resetToAi()}
                    style={{
                      fontSize: 11,
                      color: "#cbd5e1",
                      background: "transparent",
                      border: "1px solid rgba(0,229,255,0.28)",
                      borderRadius: 3,
                      padding: "4px 6px",
                      cursor: "pointer",
                      letterSpacing: "0.04em",
                      textAlign: "left",
                    }}
                  >
                    ↺ Reset to AI
                  </button>
                )}
              </div>
            )}
            {!paintMode && hasEdits && (
              <button
                data-testid="zone-reset-ai"
                onClick={() => resetToAi()}
                style={{
                  fontSize: 11,
                  color: "#cbd5e1",
                  background: "transparent",
                  border: "1px solid rgba(0,229,255,0.28)",
                  borderRadius: 3,
                  padding: "4px 6px",
                  cursor: "pointer",
                  letterSpacing: "0.04em",
                  textAlign: "left",
                }}
              >
                ↺ Reset to AI
              </button>
            )}
          </div>
        )}

        {/* Waiting state */}
        {!hasZoneMap && !loading && !error && (
          <div style={{ fontSize: 11, color: "#e2e8f0", letterSpacing: "0.05em" }}>
            Load a dataset to classify
          </div>
        )}
      </div>
      )}
    </div>
  );
};
