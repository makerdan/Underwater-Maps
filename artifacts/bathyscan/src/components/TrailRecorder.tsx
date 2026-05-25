/**
 * TrailRecorder — floating UI for recording GPS trails.
 *
 * Shows: record/stop button, elapsed time, point count, offline notice.
 * Sampling interval is read from settingsStore.gpsRecordingInterval.
 * Trail colour is user-selectable from a fixed palette.
 * On stop: saves trail to server (or buffers to localStorage if offline).
 */
import React, { useEffect, useState } from "react";
import { useGpsStore } from "@/lib/gpsStore";
import { useTrailStore } from "@/lib/trailStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { useAppState } from "@/lib/context";

const FONT: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 10,
  letterSpacing: "0.08em",
};

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Configurable sampling intervals (ms)
const INTERVALS = [
  { label: "5 s", ms: 5_000 },
  { label: "10 s", ms: 10_000 },
  { label: "30 s", ms: 30_000 },
  { label: "60 s", ms: 60_000 },
];

// Fixed trail colour palette
const TRAIL_COLOURS = [
  "#ff6600",
  "#ef4444",
  "#22d3ee",
  "#a3e635",
  "#f59e0b",
  "#a855f7",
];

async function saveTrailToServer(
  datasetId: string,
  name: string,
  colour: string,
  startedAt: number,
  endedAt: number,
  points: ReturnType<typeof useTrailStore.getState>["currentPoints"],
): Promise<void> {
  const body = {
    datasetId,
    name,
    colour,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    points: points.map((p) => ({
      lon: p.lon,
      lat: p.lat,
      accuracy: p.accuracy,
      timestamp: p.timestamp,
      seq: p.seq,
    })),
  };

  const res = await fetch(`${API_BASE}/api/trails`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Server error: ${res.status}`);
}

function bufferTrailOffline(
  datasetId: string,
  name: string,
  colour: string,
  startedAt: number,
  endedAt: number,
  points: ReturnType<typeof useTrailStore.getState>["currentPoints"],
) {
  const key = `pending-trail-${crypto.randomUUID()}`;
  localStorage.setItem(key, JSON.stringify({ datasetId, name, colour, startedAt, endedAt, points }));
}

interface Props {
  onTrailSaved?: () => void;
}

export const TrailRecorder: React.FC<Props> = ({ onTrailSaved }) => {
  const { active: gpsActive } = useGpsStore();
  const { recording, currentPoints, startedAt, startRecording, stopRecording } = useTrailStore();
  const { terrain } = useAppState();

  const gpsRecordingInterval = useSettingsStore((s) => s.gpsRecordingInterval);
  const setGpsRecordingInterval = useSettingsStore((s) => s.setGpsRecordingInterval);

  const [elapsed, setElapsed] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [trailName, setTrailName] = useState("");
  const [trailColour, setTrailColour] = useState(TRAIL_COLOURS[0]!);

  // Elapsed timer
  useEffect(() => {
    if (!recording || !startedAt) { setElapsed(0); return; }
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [recording, startedAt]);

  if (!gpsActive) return null;

  const fmtElapsed = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m.toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
  };

  const handleStop = async () => {
    const points = stopRecording();
    if (!points.length || !terrain || !startedAt) return;

    const endedAt = Date.now();
    const name = trailName.trim() || `Trail ${new Date().toLocaleDateString()}`;
    setSaving(true);
    setSaveError(null);

    try {
      if (!navigator.onLine) {
        bufferTrailOffline(terrain.datasetId, name, trailColour, startedAt, endedAt, points);
      } else {
        await saveTrailToServer(terrain.datasetId, name, trailColour, startedAt, endedAt, points);
        onTrailSaved?.();
      }
      setTrailName("");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save trail");
      bufferTrailOffline(terrain.datasetId, name, trailColour, startedAt, endedAt, points);
    } finally {
      setSaving(false);
    }
  };

  const PANEL: React.CSSProperties = {
    background: "rgba(2,8,24,0.92)",
    border: "1px solid rgba(0,229,255,0.25)",
    borderRadius: 4,
    padding: "8px 12px",
    backdropFilter: "blur(6px)",
    minWidth: 200,
  };

  const selectedInterval = INTERVALS.find((iv) => iv.ms === gpsRecordingInterval) ?? INTERVALS[1]!;

  return (
    <div data-testid="trail-recorder" style={{ ...FONT, ...PANEL }}>
      <div style={{ color: "#00e5ff", fontSize: 9, letterSpacing: "0.2em", marginBottom: 6, fontWeight: 700 }}>
        ⏺ GPS TRAIL
      </div>

      {!recording ? (
        <>
          <input
            type="text"
            value={trailName}
            onChange={(e) => setTrailName(e.target.value.slice(0, 60))}
            placeholder="Trail name (optional)"
            data-testid="trail-name-input"
            style={{
              width: "100%",
              background: "rgba(0,229,255,0.04)",
              border: "1px solid rgba(0,229,255,0.15)",
              borderRadius: 3,
              color: "#e2e8f0",
              fontSize: 10,
              padding: "4px 6px",
              fontFamily: "inherit",
              boxSizing: "border-box",
              outline: "none",
              marginBottom: 6,
            }}
          />

          {/* Trail colour picker */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
            <span style={{ color: "#475569", fontSize: 9 }}>COLOUR</span>
            <div style={{ display: "flex", gap: 4, marginLeft: 4 }}>
              {TRAIL_COLOURS.map((col) => (
                <button
                  key={col}
                  onClick={() => setTrailColour(col)}
                  title={col}
                  data-testid={`trail-colour-${col.replace("#", "")}`}
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: col,
                    border: trailColour === col ? "2px solid #fff" : "2px solid transparent",
                    cursor: "pointer",
                    padding: 0,
                    outline: trailColour === col ? "1px solid rgba(255,255,255,0.5)" : "none",
                    outlineOffset: 1,
                  }}
                />
              ))}
            </div>
          </div>

          {/* Sampling interval selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
            <span style={{ color: "#475569", fontSize: 9 }}>INTERVAL</span>
            <div style={{ display: "flex", gap: 3, marginLeft: 4 }}>
              {INTERVALS.map((iv) => (
                <button
                  key={iv.ms}
                  onClick={() => setGpsRecordingInterval(iv.ms)}
                  style={{
                    background: gpsRecordingInterval === iv.ms ? "rgba(0,229,255,0.15)" : "none",
                    border: `1px solid ${gpsRecordingInterval === iv.ms ? "rgba(0,229,255,0.5)" : "rgba(0,229,255,0.1)"}`,
                    borderRadius: 2,
                    color: gpsRecordingInterval === iv.ms ? "#00e5ff" : "#475569",
                    fontSize: 9,
                    padding: "1px 5px",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {iv.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => startRecording(gpsRecordingInterval)}
            data-testid="trail-start-btn"
            style={{
              background: "rgba(239,68,68,0.15)",
              border: "1px solid rgba(239,68,68,0.5)",
              borderRadius: 3,
              color: "#ef4444",
              fontSize: 10,
              padding: "5px 10px",
              cursor: "pointer",
              fontFamily: "inherit",
              letterSpacing: "0.1em",
              width: "100%",
            }}
          >
            ⏺ START RECORDING
          </button>
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 16, marginBottom: 2, color: "#94a3b8" }}>
            <span data-testid="trail-elapsed"><span style={{ color: "#ef4444" }}>⏺ </span>{fmtElapsed(elapsed)}</span>
            <span data-testid="trail-point-count">{currentPoints.length} pts</span>
          </div>
          <div style={{ fontSize: 9, color: "#475569", marginBottom: 6 }}>
            every {selectedInterval.label}
          </div>
          <button
            onClick={() => void handleStop()}
            disabled={saving}
            data-testid="trail-stop-btn"
            style={{
              background: "rgba(0,229,255,0.1)",
              border: "1px solid rgba(0,229,255,0.35)",
              borderRadius: 3,
              color: saving ? "#475569" : "#00e5ff",
              fontSize: 10,
              padding: "5px 10px",
              cursor: saving ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              letterSpacing: "0.1em",
              width: "100%",
            }}
          >
            {saving ? "SAVING..." : "⏹ STOP & SAVE"}
          </button>
        </>
      )}

      {saveError && (
        <div style={{ color: "#ef4444", fontSize: 9, marginTop: 4 }}>
          ⚠ {saveError} (buffered offline)
        </div>
      )}

      {!navigator.onLine && (
        <div style={{ color: "#f97316", fontSize: 9, marginTop: 4 }}>
          ⚠ Offline — points buffered locally
        </div>
      )}
    </div>
  );
};
