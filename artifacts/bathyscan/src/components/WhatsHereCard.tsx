/**
 * WhatsHereCard — floating summary card showing terrain and conditions data
 * for the camera crosshair position.
 *
 * Features:
 *   - Depth, substrate, habitat score, tidal state, and temperature rows.
 *   - Pin toggle to keep the card open and update live as the camera moves.
 *   - Auto-closes after 8 seconds unless pinned.
 *   - Auto-closes on camera movement unless pinned.
 *   - Graceful no-data state when no overlays are active.
 */
import React, { useEffect, useRef } from "react";
import { useUiStore } from "@/lib/uiStore";
import { useCameraStore } from "@/lib/cameraStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { useIsNarrow } from "@/hooks/use-mobile";
import { formatDepth, formatTemperature } from "@/lib/units";
import type { WhatsHereData } from "@/hooks/useWhatsHere";

const AUTO_CLOSE_MS = 8_000;

const FONT = "'JetBrains Mono', 'Fira Code', monospace";

const cardStyle: React.CSSProperties = {
  position: "absolute",
  zIndex: 50,
  pointerEvents: "auto",
  background: "rgba(2,8,18,0.94)",
  border: "1px solid rgba(0,229,255,0.32)",
  borderRadius: 6,
  backdropFilter: "blur(8px)",
  fontFamily: FONT,
  fontSize: 16.5,
  color: "#e2e8f0",
  letterSpacing: "0.07em",
  minWidth: 210,
  maxWidth: 270,
  userSelect: "none",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: 8,
  padding: "3px 0",
  borderTop: "1px solid rgba(0,229,255,0.06)",
};

const labelStyle: React.CSSProperties = {
  fontSize: 13.5,
  letterSpacing: "0.18em",
  color: "#64748b",
  textTransform: "uppercase",
  flexShrink: 0,
};

const valueStyle: React.CSSProperties = {
  color: "#e2e8f0",
  textAlign: "right",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const cyanValueStyle: React.CSSProperties = {
  ...valueStyle,
  color: "#00e5ff",
  textShadow: "0 0 6px rgba(0,229,255,0.4)",
};

const amberValueStyle: React.CSSProperties = {
  ...valueStyle,
  color: "#fb923c",
  textShadow: "0 0 6px rgba(251,146,60,0.35)",
};

const greenValueStyle: React.CSSProperties = {
  ...valueStyle,
  color: "#34d399",
};

interface WhatsHereCardProps {
  data: WhatsHereData;
}

export const WhatsHereCard: React.FC<WhatsHereCardProps> = ({ data }) => {
  const isNarrow = useIsNarrow();
  const units = useSettingsStore((s) => s.units);
  const whatsHerePinned = useUiStore((s) => s.whatsHerePinned);
  const setWhatsHerePinned = useUiStore((s) => s.setWhatsHerePinned);
  const setWhatsHereOpen = useUiStore((s) => s.setWhatsHereOpen);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinnedRef = useRef(whatsHerePinned);
  pinnedRef.current = whatsHerePinned;

  const resetTimer = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    if (!pinnedRef.current) {
      timerRef.current = setTimeout(() => {
        if (!pinnedRef.current) setWhatsHereOpen(false);
      }, AUTO_CLOSE_MS);
    }
  };

  useEffect(() => {
    resetTimer();
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (whatsHerePinned) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    } else {
      resetTimer();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whatsHerePinned]);

  useEffect(() => {
    const unsub = useCameraStore.subscribe((state, prevState) => {
      if (pinnedRef.current) return;
      if (
        state.cameraLon !== prevState.cameraLon ||
        state.cameraLat !== prevState.cameraLat ||
        state.cameraDepth !== prevState.cameraDepth ||
        state.heading !== prevState.heading
      ) {
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        setWhatsHereOpen(false);
      }
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    depth, substrateActive, substrateName,
    habitatActive, habitatSpeciesLabel, habitatScore,
    tidalActive, tidalPhase, tidalHeight,
    tempC, tempLive, hasAnyData,
  } = data;

  const fmtDepth = (m: number): string => {
    const formatted = formatDepth(Math.abs(m), { units }).toUpperCase();
    return m >= 0 ? `-${formatted}` : `+${formatted}`;
  };

  const position: React.CSSProperties = isNarrow
    ? { bottom: 72, left: 16 }
    : { bottom: 72, left: "50%", transform: "translateX(-50%)" };

  return (
    <div
      data-testid="whats-here-card"
      style={{ ...cardStyle, ...position }}
      role="dialog"
      aria-label="What's Here summary"
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "7px 10px 5px",
        }}
      >
        <span
          style={{
            fontSize: 15,
            letterSpacing: "0.2em",
            color: "#00e5ff",
            textShadow: "0 0 6px rgba(0,229,255,0.45)",
            fontWeight: 700,
          }}
        >
          ◎ WHAT'S HERE?
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            data-testid="whats-here-pin"
            aria-label={whatsHerePinned ? "Unpin card" : "Pin card to keep open"}
            aria-pressed={whatsHerePinned}
            onClick={() => {
              const next = !whatsHerePinned;
              setWhatsHerePinned(next);
            }}
            title={whatsHerePinned ? "Unpin — card will auto-close on next press" : "Pin — card stays open and updates live"}
            style={{
              background: whatsHerePinned ? "rgba(0,229,255,0.14)" : "transparent",
              border: `1px solid ${whatsHerePinned ? "rgba(0,229,255,0.5)" : "rgba(100,116,139,0.4)"}`,
              borderRadius: 3,
              color: whatsHerePinned ? "#00e5ff" : "#64748b",
              fontFamily: FONT,
              fontSize: 16.5,
              padding: "1px 5px",
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            📌
          </button>
          <button
            data-testid="whats-here-close"
            aria-label="Close"
            onClick={() => setWhatsHereOpen(false)}
            style={{
              background: "transparent",
              border: "1px solid rgba(100,116,139,0.4)",
              borderRadius: 3,
              color: "#64748b",
              fontFamily: FONT,
              fontSize: 16.5,
              padding: "1px 6px",
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "2px 10px 8px" }}>
        {/* Depth row — always shown when crosshair has terrain */}
        {depth !== null && (
          <div style={rowStyle}>
            <span style={labelStyle}>Depth</span>
            <span style={cyanValueStyle}>{fmtDepth(depth)}</span>
          </div>
        )}

        {/* Substrate row */}
        {substrateActive && (
          <div style={rowStyle} data-testid="whats-here-substrate-row">
            <span style={labelStyle}>Substrate</span>
            <span style={substrateName ? valueStyle : { ...valueStyle, color: "#475569" }}>
              {substrateName ?? "—"}
            </span>
          </div>
        )}

        {/* Habitat row */}
        {habitatActive && habitatSpeciesLabel !== null && (
          <div style={rowStyle}>
            <span style={labelStyle}>{habitatSpeciesLabel}</span>
            <span style={habitatScore !== null ? amberValueStyle : { ...amberValueStyle, color: "#475569" }}>
              {habitatScore !== null ? `${Math.round(habitatScore * 100)}%` : "—"}
            </span>
          </div>
        )}

        {/* Tidal row */}
        {tidalActive && (
          <div style={rowStyle}>
            <span style={labelStyle}>Tide</span>
            <span style={greenValueStyle}>
              {tidalPhase ?? "—"}
              {tidalHeight !== null && (
                <span style={{ color: "#94a3b8", marginLeft: 4 }}>
                  {tidalHeight >= 0 ? "+" : ""}
                  {formatDepth(Math.abs(tidalHeight), { units, decimals: 1 })}
                </span>
              )}
            </span>
          </div>
        )}

        {/* Temperature row */}
        {tempC !== null && (
          <div style={rowStyle}>
            <span style={labelStyle}>Temp @ depth</span>
            <span style={{ ...valueStyle, color: "#fb923c" }}>
              {formatTemperature(tempC)}
              <span
                style={{
                  marginLeft: 4,
                  fontSize: 12,
                  color: tempLive ? "#22d3ee" : "#f59e0b",
                  background: tempLive ? "rgba(0,229,255,0.08)" : "rgba(245,158,11,0.10)",
                  border: `1px solid ${tempLive ? "rgba(0,229,255,0.25)" : "rgba(245,158,11,0.4)"}`,
                  borderRadius: 2,
                  padding: "0 3px",
                  letterSpacing: "0.12em",
                }}
              >
                {tempLive ? "LIVE" : "EST"}
              </span>
            </span>
          </div>
        )}

        {/* No-data prompt */}
        {!hasAnyData && (
          <div
            style={{
              marginTop: 4,
              fontSize: 15,
              color: "#64748b",
              lineHeight: 1.5,
              letterSpacing: "0.04em",
            }}
          >
            Enable Substrate or Habitat overlays to see more detail here.
          </div>
        )}

        {/* Pin hint */}
        {!whatsHerePinned && (
          <div
            style={{
              marginTop: 6,
              fontSize: 13.5,
              color: "#334155",
              letterSpacing: "0.06em",
            }}
          >
            Auto-closes in 8 s · 📌 to keep open
          </div>
        )}
        {whatsHerePinned && (
          <div
            style={{
              marginTop: 6,
              fontSize: 13.5,
              color: "#0ea5e9",
              letterSpacing: "0.06em",
            }}
          >
            ◉ Live · pinned — updates as you fly
          </div>
        )}
      </div>
    </div>
  );
};
