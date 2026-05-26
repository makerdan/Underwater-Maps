/**
 * SubstrateDetailPanel — substrate polygon info card opened by clicking a
 * polygon either in the 2D OverviewMap or in the 3D scene (SubstrateLayer).
 *
 * Driven by `useUiStore.selectedSubstrate`; mounted once at the App root so
 * it sits above both the HUD (z-30) and the OverviewMap (z-40). Closes on
 * Escape or the × button without disturbing the underlying view because the
 * Escape handler runs in the capture phase and stops propagation only when
 * this panel is the topmost dismissible thing.
 */
import React, { useEffect } from "react";
import { useUiStore } from "@/lib/uiStore";

export const SubstrateDetailPanel: React.FC = () => {
  const selectedSubstrate = useUiStore((s) => s.selectedSubstrate);
  const setSelectedSubstrate = useUiStore((s) => s.setSelectedSubstrate);

  useEffect(() => {
    if (!selectedSubstrate) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setSelectedSubstrate(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [selectedSubstrate, setSelectedSubstrate]);

  if (!selectedSubstrate) return null;

  const MONO = "'JetBrains Mono', monospace";
  return (
    <div
      data-testid="substrate-info-card"
      role="dialog"
      aria-label={`Substrate feature ${selectedSubstrate.shoreZoneClass}`}
      style={{
        position: "absolute",
        top: "50%",
        right: 16,
        transform: "translateY(-50%)",
        background: "rgba(0,10,20,0.92)",
        border: "1px solid rgba(0,229,255,0.15)",
        borderLeft: `3px solid ${selectedSubstrate.color}`,
        borderRadius: 4,
        padding: "8px 12px",
        backdropFilter: "blur(6px)",
        pointerEvents: "auto",
        maxWidth: 280,
        minWidth: 220,
        fontFamily: MONO,
        fontSize: 10,
        color: "#94a3b8",
        zIndex: 60,
        boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6,
        }}
      >
        <span style={{ color: "#475569", fontSize: 9, letterSpacing: "0.2em" }}>
          SUBSTRATE FEATURE
        </span>
        <button
          onClick={() => setSelectedSubstrate(null)}
          aria-label="Close substrate info"
          style={{
            background: "transparent",
            border: "none",
            color: "#64748b",
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
            padding: 0,
          }}
        >
          ×
        </button>
      </div>
      <div style={{ marginBottom: 4 }}>
        <span style={{ color: "#475569" }}>CLASS </span>
        <span style={{ color: "#00e5ff", fontWeight: 700 }}>
          {selectedSubstrate.shoreZoneClass}
        </span>
      </div>
      <div style={{ marginBottom: 4 }}>
        <span style={{ color: "#475569" }}>SUBSTRATE </span>
        <span style={{ color: selectedSubstrate.color, fontWeight: 700 }}>
          {selectedSubstrate.substrate.toUpperCase()}
        </span>
      </div>
      <div style={{ marginBottom: 4 }}>
        <span style={{ color: "#475569" }}>CMECS </span>
        <span style={{ color: "#cbd5e1" }}>{selectedSubstrate.cmecsCode}</span>
      </div>
      <div style={{ marginBottom: 4 }}>
        <span style={{ color: "#475569" }}>UNIT </span>
        <span style={{ color: "#cbd5e1" }}>{selectedSubstrate.unitId}</span>
      </div>
      {(selectedSubstrate.szMaterial || selectedSubstrate.szForm) && (
        <div style={{ marginBottom: 4, color: "#94a3b8", fontSize: 9 }}>
          {selectedSubstrate.szMaterial ?? "—"}
          {" · "}
          {selectedSubstrate.szForm ?? "—"}
        </div>
      )}
      {typeof selectedSubstrate.areaSqM === "number" && (
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "#475569" }}>AREA </span>
          <span style={{ color: "#cbd5e1" }}>
            {Math.round(selectedSubstrate.areaSqM).toLocaleString()} m²
          </span>
        </div>
      )}
      {selectedSubstrate.natsur && (
        <div
          data-testid="substrate-info-natsur"
          style={{
            marginTop: 6,
            paddingTop: 6,
            borderTop: "1px solid rgba(148,163,184,0.2)",
            color: "#cbd5e1",
            fontSize: 9,
            lineHeight: 1.45,
          }}
        >
          {selectedSubstrate.natsur}
        </div>
      )}
      {selectedSubstrate.encChart &&
        /^https?:\/\//.test(selectedSubstrate.encChart) && (
          <div style={{ marginTop: 6 }}>
            <a
              data-testid="substrate-info-feature-link"
              href={selectedSubstrate.encChart}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#7dd3fc", textDecoration: "underline", fontSize: 9 }}
            >
              ↗ TPWD lake page
            </a>
          </div>
        )}
      <div
        style={{
          marginTop: 8,
          paddingTop: 6,
          borderTop: "1px solid rgba(148,163,184,0.2)",
          color: "#64748b",
          fontSize: 9,
          lineHeight: 1.4,
        }}
      >
        <span>Credit: </span>
        <a
          href={selectedSubstrate.creditUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#7dd3fc", textDecoration: "underline" }}
        >
          {selectedSubstrate.sourceName}
        </a>
      </div>
    </div>
  );
};
