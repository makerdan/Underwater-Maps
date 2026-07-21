/**
 * EfhDetailPanel — species info card opened by clicking an EFH polygon
 * either in the 2D OverviewMap or in the 3D scene (EfhZoneLayer).
 *
 * Driven by `useUiStore.selectedEfh`; closes on Escape or the × button
 * without disturbing the underlying view (camera in 3D, pan/zoom in 2D)
 * because the Escape handler runs in the capture phase and stops
 * propagation only when this panel is the one consuming the key.
 */
import React, { useEffect } from "react";
import type { EfhSpeciesProperties } from "@workspace/api-client-react";
import { useUiStore } from "@/lib/uiStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { formatDepth } from "@/lib/units";
import { HelpIcon } from "@/components/help/HelpButton";

export const EfhDetailPanel: React.FC = () => {
  const properties = useUiStore((s) => s.selectedEfh);
  const setSelectedEfh = useUiStore((s) => s.setSelectedEfh);
  const units = useSettingsStore((s) => s.units);

  // Close on Escape — capture phase so we win against App.tsx's global
  // Escape handler (which would otherwise close the Overview Map / move
  // the camera focus) when this panel is the topmost dismissible thing.
  useEffect(() => {
    if (!properties) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setSelectedEfh(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [properties, setSelectedEfh]);

  if (!properties) return null;
  const p = properties;
  const onClose = () => setSelectedEfh(null);

  const depthRange = Array.isArray(p.depthRangeM) && p.depthRangeM.length >= 2
    ? `${formatDepth(p.depthRangeM[0]!, { units })} – ${formatDepth(p.depthRangeM[1]!, { units })}`
    : null;

  const MONO = "'JetBrains Mono', monospace";
  const swatchColor = p.color ?? "#00e5ff";

  return (
    <div
      role="dialog"
      aria-label={`Essential Fish Habitat details for ${p.commonName}`}
      data-testid="efh-detail-panel"
      style={{
        position: "absolute",
        top: 56,
        right: 16,
        width: 320,
        maxHeight: "calc(100vh - 80px)",
        overflowY: "auto",
        background: "rgba(2,8,24,0.94)",
        backdropFilter: "blur(8px)",
        border: `1px solid ${swatchColor}55`,
        borderLeft: `3px solid ${swatchColor}`,
        borderRadius: 4,
        padding: "12px 14px 14px",
        zIndex: 60,
        boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
        fontFamily: MONO,
        color: "#e2e8f0",
        pointerEvents: "auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 10,
            height: 10,
            background: swatchColor,
            borderRadius: 2,
            marginTop: 4,
            flexShrink: 0,
            boxShadow: `0 0 6px ${swatchColor}80`,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "calc(18px * var(--bs-font-scale, 1))", color: "#f8fafc", fontWeight: 600, letterSpacing: "0.04em" }}>
            {p.commonName}
          </div>
          <div style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#cbd5e1", fontStyle: "italic", marginTop: 2 }}>
            {p.species?.replace(/_/g, " ")}
          </div>
        </div>
        <HelpIcon articleId="essential-fish-habitat" label="Essential Fish Habitat" />
        <button
          onClick={onClose}
          aria-label="Close species details"
          style={{
            background: "transparent",
            border: "none",
            color: "#cbd5e1",
            cursor: "pointer",
            fontSize: "calc(24px * var(--bs-font-scale, 1))",
            lineHeight: 1,
            padding: 0,
            marginLeft: 4,
          }}
        >
          ×
        </button>
      </div>

      <DetailRow label="FMP" value={p.fmp} />
      {p.lifeStage && <DetailRow label="Life stage" value={p.lifeStage} />}
      {p.season && <DetailRow label="Season" value={p.season} />}
      {depthRange && <DetailRow label="Depth" value={depthRange} />}

      {p.habitatDescription && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#94a3b8", letterSpacing: "0.15em", marginBottom: 4 }}>
            HABITAT
          </div>
          <div style={{ fontSize: "calc(15px * var(--bs-font-scale, 1))", lineHeight: 1.5, color: "#cbd5e1" }}>
            {p.habitatDescription}
          </div>
        </div>
      )}

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(0,229,255,0.1)" }}>
        <div style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#94a3b8", letterSpacing: "0.15em", marginBottom: 4 }}>
          SOURCE
        </div>
        <div style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#e2e8f0", marginBottom: 4 }}>{p.source}</div>
        {p.source?.startsWith("TPWD") && (
          <div
            style={{
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
              color: "#fb923c",
              marginBottom: 4,
              fontStyle: "italic",
            }}
          >
            Texas Parks &amp; Wildlife — priority habitat; not federal EFH.
          </div>
        )}
        {p.creditUrl && (
          <a
            href={p.creditUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
              color: "#00e5ff",
              textDecoration: "none",
              wordBreak: "break-all",
            }}
          >
            {p.source?.startsWith("TPWD") ? "↗ TPWD lake page" : "↗ NOAA EFH shapefiles"}
          </a>
        )}
      </div>
    </div>
  );
};

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ display: "flex", gap: 8, fontSize: "calc(15px * var(--bs-font-scale, 1))", marginTop: 4 }}>
    <span style={{ color: "#cbd5e1", minWidth: 72, fontSize: "calc(13.5px * var(--bs-font-scale, 1))", letterSpacing: "0.08em" }}>
      {label.toUpperCase()}
    </span>
    <span style={{ color: "#e2e8f0", flex: 1 }}>{value}</span>
  </div>
);

// Re-export the type for convenience.
export type { EfhSpeciesProperties };
