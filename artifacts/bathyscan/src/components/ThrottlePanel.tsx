import React, { useRef, useState, useCallback, useEffect } from "react";
import {
  BOAT_MIN_MPH,
  BOAT_MAX_MPH,
  BOAT_TICK_SPEEDS,
  mphToKnots,
} from "@/lib/boatSpeed";
import { useAppState } from "@/lib/context";
import { useSettingsStore } from "@/lib/settingsStore";
import { formatSpeed, MPH_TO_KPH } from "@/lib/units";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { HelpIcon } from "@/components/help/HelpButton";

const LEVER_TRACK_H = 160;
const LEVER_THUMB_H = 28;
const LEVER_TRAVEL = LEVER_TRACK_H - LEVER_THUMB_H;

function mphToFraction(mph: number): number {
  return (mph - BOAT_MIN_MPH) / (BOAT_MAX_MPH - BOAT_MIN_MPH);
}

function fractionToMph(f: number): number {
  return BOAT_MIN_MPH + f * (BOAT_MAX_MPH - BOAT_MIN_MPH);
}

function clampMph(mph: number): number {
  return Math.max(BOAT_MIN_MPH, Math.min(BOAT_MAX_MPH, mph));
}

function roundToTenth(mph: number): number {
  return Math.round(mph * 10) / 10;
}

function mphToDisplay(mph: number, units: "metric" | "imperial"): number {
  return units === "imperial" ? mph : mph * MPH_TO_KPH;
}

function displayToMph(value: number, units: "metric" | "imperial"): number {
  return units === "imperial" ? value : value / MPH_TO_KPH;
}

function formatDisplayValue(mph: number, units: "metric" | "imperial"): string {
  const v = mphToDisplay(mph, units);
  return String(Math.round(v * 10) / 10);
}

const PANEL_STYLE: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  background: "rgba(0,10,20,0.88)",
  border: "1px solid rgba(0,229,255,0.25)",
  borderRadius: 6,
  backdropFilter: "blur(6px)",
  color: "#94a3b8",
  userSelect: "none",
  overflow: "hidden",
};

const CYAN: React.CSSProperties = {
  color: "#00e5ff",
  textShadow: "0 0 8px rgba(0,229,255,0.5)",
};

interface ThrottlePanelProps {
  onClose?: () => void;
}

export const ThrottlePanel: React.FC<ThrottlePanelProps> = ({ onClose }) => {
  const { boatSpeedMph, setBoatSpeedMph } = useAppState();
  const units = useSettingsStore((s) => s.units);
  const [minimized, setMinimized] = useState(false);
  const [inputVal, setInputVal] = useState<string>(formatDisplayValue(boatSpeedMph, units));
  const [dragging, setDragging] = useState(false);

  const trackRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragStartMph = useRef(boatSpeedMph);

  useEffect(() => {
    if (!dragging) {
      setInputVal(formatDisplayValue(boatSpeedMph, units));
    }
  }, [boatSpeedMph, dragging, units]);

  const fraction = mphToFraction(boatSpeedMph);
  const thumbTop = (1 - fraction) * LEVER_TRAVEL;

  const applyMph = useCallback((mph: number) => {
    const clamped = roundToTenth(clampMph(mph));
    setBoatSpeedMph(clamped);
    setInputVal(formatDisplayValue(clamped, units));
  }, [setBoatSpeedMph, units]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartY.current = e.clientY;
    dragStartMph.current = boatSpeedMph;
    setDragging(true);
  }, [boatSpeedMph]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    const dy = e.clientY - dragStartY.current;
    const dFrac = -dy / LEVER_TRAVEL;
    const newMph = roundToTenth(clampMph(dragStartMph.current + dFrac * (BOAT_MAX_MPH - BOAT_MIN_MPH)));
    setBoatSpeedMph(newMph);
    setInputVal(formatDisplayValue(newMph, units));
  }, [dragging, setBoatSpeedMph, units]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    setBoatSpeedMph(roundToTenth(clampMph(boatSpeedMph)));
  }, [boatSpeedMph, setBoatSpeedMph]);

  const onTrackClick = useCallback((e: React.MouseEvent) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const frac = 1 - relY / LEVER_TRACK_H;
    applyMph(fractionToMph(Math.max(0, Math.min(1, frac))));
  }, [applyMph]);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputVal(e.target.value);
  };

  const commitInput = () => {
    const n = parseFloat(inputVal);
    if (!isNaN(n)) {
      applyMph(displayToMph(n, units));
    } else {
      setInputVal(formatDisplayValue(boatSpeedMph, units));
    }
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      commitInput();
      (e.target as HTMLInputElement).blur();
    }
  };

  const knots = mphToKnots(boatSpeedMph);
  const unitSuffix = units === "imperial" ? "mph" : "km/h";
  const inputMin = Math.round(mphToDisplay(BOAT_MIN_MPH, units) * 10) / 10;
  const inputMax = Math.round(mphToDisplay(BOAT_MAX_MPH, units) * 10) / 10;

  if (minimized) {
    return (
      <ViewscreenTooltip label="Expand throttle panel" side="left">
        <div
          style={{
            ...PANEL_STYLE,
            padding: "6px 12px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            cursor: "pointer",
            fontSize: 11,
            letterSpacing: "0.12em",
          }}
          onClick={() => setMinimized(false)}
        >
          <span style={{ color: "#22d3ee", fontSize: 13 }}>⛵</span>
          <span style={CYAN}>{formatSpeed(boatSpeedMph, { units }).toUpperCase()}</span>
          <span style={{ color: "#475569" }}>/</span>
          <span style={{ color: "#7dd3fc" }}>{knots.toFixed(1)} KT</span>
          <span style={{ color: "#1e3a5f", fontSize: 10 }}>▲</span>
        </div>
      </ViewscreenTooltip>
    );
  }

  return (
    <div style={{ ...PANEL_STYLE, width: 140 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 10px 4px",
          borderBottom: "1px solid rgba(0,229,255,0.1)",
        }}
      >
        <span style={{ fontSize: 9, letterSpacing: "0.25em", color: "#475569", display: "inline-flex", alignItems: "center", gap: 6 }}>
          THROTTLE
          <HelpIcon articleId="throttle" label="Throttle panel" />
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          <ViewscreenTooltip label="Collapse the throttle panel" side="left">
            <button
              onClick={() => setMinimized(true)}
              style={{
                background: "none",
                border: "none",
                color: "#334155",
                cursor: "pointer",
                fontSize: 10,
                padding: "0 2px",
                lineHeight: 1,
              }}
            >
              ▼
            </button>
          </ViewscreenTooltip>
          {onClose && (
            <ViewscreenTooltip label="Close the throttle panel" side="left">
              <button
                onClick={onClose}
                style={{
                  background: "none",
                  border: "none",
                  color: "#334155",
                  cursor: "pointer",
                  fontSize: 11,
                  padding: "0 2px",
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </ViewscreenTooltip>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "10px 0 4px" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ ...CYAN, fontSize: 15, fontWeight: 700, letterSpacing: "0.05em" }}>
            {formatSpeed(boatSpeedMph, { units }).toUpperCase()}
          </div>
          <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.15em", marginTop: 1 }}>
            {knots.toFixed(1)} KT
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          gap: 6,
          padding: "4px 14px 10px",
        }}
      >
        <div
          ref={trackRef}
          onClick={onTrackClick}
          style={{
            position: "relative",
            width: 20,
            height: LEVER_TRACK_H,
            background: "rgba(0,229,255,0.04)",
            border: "1px solid rgba(0,229,255,0.15)",
            borderRadius: 10,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              position: "absolute",
              bottom: LEVER_THUMB_H / 2,
              top: LEVER_THUMB_H / 2,
              left: "50%",
              width: 2,
              transform: "translateX(-50%)",
              background: `linear-gradient(to top, rgba(0,229,255,0.6) ${fraction * 100}%, rgba(30,58,95,0.4) ${fraction * 100}%)`,
              borderRadius: 2,
            }}
          />

          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            style={{
              position: "absolute",
              left: "50%",
              top: thumbTop,
              width: 20,
              height: LEVER_THUMB_H,
              transform: "translateX(-50%)",
              background: dragging
                ? "linear-gradient(135deg, #00e5ff, #0369a1)"
                : "linear-gradient(135deg, rgba(0,229,255,0.6), rgba(3,105,161,0.8))",
              border: "1px solid rgba(0,229,255,0.5)",
              borderRadius: 4,
              cursor: dragging ? "grabbing" : "grab",
              zIndex: 2,
              boxShadow: dragging ? "0 0 10px rgba(0,229,255,0.5)" : "0 0 4px rgba(0,229,255,0.2)",
              transition: dragging ? "none" : "box-shadow 0.15s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div style={{ width: 10, height: 2, background: "rgba(255,255,255,0.6)", borderRadius: 1 }} />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: LEVER_TRACK_H,
            justifyContent: "space-between",
            paddingTop: LEVER_THUMB_H / 2,
            paddingBottom: LEVER_THUMB_H / 2,
            fontSize: 8,
            letterSpacing: "0.1em",
            color: "#334155",
          }}
        >
          {[...BOAT_TICK_SPEEDS].reverse().map((tick) => (
            <div
              key={tick}
              style={{
                cursor: "pointer",
                color: Math.abs(tick - boatSpeedMph) < 2 ? "#00e5ff" : "#334155",
                textShadow: Math.abs(tick - boatSpeedMph) < 2 ? "0 0 6px rgba(0,229,255,0.5)" : "none",
                transition: "color 0.15s",
              }}
              onClick={() => applyMph(tick)}
            >
              {Math.round(mphToDisplay(tick, units))}
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "0 12px 10px", display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="number"
          min={inputMin}
          max={inputMax}
          value={inputVal}
          onChange={onInputChange}
          onBlur={commitInput}
          onKeyDown={onInputKeyDown}
          style={{
            width: "100%",
            background: "rgba(0,229,255,0.05)",
            border: "1px solid rgba(0,229,255,0.2)",
            borderRadius: 3,
            color: "#e2e8f0",
            fontFamily: "inherit",
            fontSize: 11,
            textAlign: "center",
            padding: "3px 6px",
            outline: "none",
          }}
        />
        <span style={{ fontSize: 9, color: "#475569", whiteSpace: "nowrap" }}>{unitSuffix}</span>
      </div>
    </div>
  );
};
