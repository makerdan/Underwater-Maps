/**
 * QueryPanel — natural-language terrain query interface.
 *
 * Slides up from the bottom of the screen. Press `/` to open and focus the input.
 * Press Escape to close and clear highlights.
 *
 * Submitting a query:
 *   1. Calls queryLLM (→ POST /api/query → OpenAI tool calling)
 *   2. Executes each returned tool via executeTool
 *   3. Displays the LLM's text response in a result banner
 *
 * Query history (last 10) is persisted in localStorage.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { queryLLM } from "@/lib/queryLLM";
import { HelpIcon } from "@/components/help/HelpButton";
import { executeTool } from "@/lib/queryTools";
import { useTerrainStore } from "@/lib/terrainStore";
import { useCameraStore } from "@/lib/cameraStore";
import { useClassificationStore } from "@/lib/classificationStore";
import { useOfflineStore } from "@/lib/offlineStore";
import { SALTWATER_ZONES, FRESHWATER_ZONES } from "@/lib/zoneMap";
import type { QueryContext } from "@/lib/queryLLM";
import type { ToolOptions } from "@/lib/queryTools";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { useSettingsStore } from "@/lib/settingsStore";

const HISTORY_KEY = "bsquery-history";
const MAX_HISTORY = 10;

const STARTER_QUERIES = [
  "Take me to the deepest point",
  "Show everything shallower than 200 m",
  "What's the average depth?",
  "Find the steepest slopes",
  "Where am I? Tell me about this spot",
];

interface QueryPanelProps {
  open: boolean;
  onClose: () => void;
  setDatasetId: (id: string | null) => void;
}

function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as string[];
  } catch { return []; }
}

function saveHistory(hist: string[]): void {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(0, MAX_HISTORY))); } catch {}
}

export function QueryPanel({ open, onClose, setDatasetId }: QueryPanelProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [statBanner, setStatBanner] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>(loadHistory);
  const inputRef = useRef<HTMLInputElement>(null);
  const isOnline = useOfflineStore((s) => s.isOnline);
  const llmDisclosureAcknowledged = useSettingsStore((s) => s.llmDisclosureAcknowledged);
  const setLlmDisclosureAcknowledged = useSettingsStore((s) => s.setLlmDisclosureAcknowledged);

  // Holds the AbortController for the currently in-flight request so we can
  // cancel it before sending a new one or when the panel unmounts.
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight stream when the panel unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  // Focus input when panel opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  // Cancel any in-flight stream when the panel is closed.
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
    }
  }, [open]);

  const buildContext = useCallback((): QueryContext => {
    const grid = useTerrainStore.getState().activeGrid;
    const cam  = useCameraStore.getState();
    const zoneMap = useClassificationStore.getState().zoneMap;

    const topZones: string[] = [];
    if (zoneMap && grid) {
      const isFresh = grid.waterType === "freshwater";
      const zones = isFresh ? FRESHWATER_ZONES : SALTWATER_ZONES;
      const counts = new Array<number>(8).fill(0);
      for (let i = 0; i < zoneMap.length; i++) counts[zoneMap[i] ?? 0]! += 1;
      counts
        .map((c, i) => ({ c, i }))
        .sort((a, b) => b.c - a.c)
        .slice(0, 3)
        .forEach(({ i }) => { const name = zones[i]; if (name) topZones.push(name); });
    }

    return {
      datasetName: grid?.name ?? grid?.datasetId ?? "Unknown",
      waterType:   grid?.waterType,
      minDepth:    grid?.minDepth ?? 0,
      maxDepth:    grid?.maxDepth ?? 1000,
      cameraLon:   cam.cameraPosition.known ? cam.cameraPosition.lon : null,
      cameraLat:   cam.cameraPosition.known ? cam.cameraPosition.lat : null,
      cameraDepth: cam.cameraDepth,
      topZones,
    };
  }, []);

  const handleSubmit = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    // Require disclosure acknowledgment before sending any data to the LLM.
    if (!llmDisclosureAcknowledged) return;

    // Cancel any previous in-flight request before starting a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setResult(null);
    setStatBanner(null);

    // Save to history
    setHistory((prev) => {
      const next = [trimmed, ...prev.filter((h) => h !== trimmed)].slice(0, MAX_HISTORY);
      saveHistory(next);
      return next;
    });

    const opts: ToolOptions = {
      setDatasetId,
      onStatResult: (text) => setStatBanner(text),
      onDescription: (text) => setResult(text),
    };

    try {
      const ctx = buildContext();
      const llmResult = await queryLLM(trimmed, ctx, controller.signal);

      // Execute each tool
      const toolMessages: string[] = [];
      for (const tc of llmResult.toolCalls) {
        const msg = executeTool(tc.name, tc.args, opts);
        if (msg) toolMessages.push(msg);
      }

      // Display LLM text response or tool feedback
      const displayText = llmResult.textResponse ?? (toolMessages.length > 0 ? toolMessages.join(" ") : null);
      setResult(displayText);
    } catch (err) {
      // Ignore AbortError — the user cancelled intentionally or navigated away.
      if (err instanceof Error && err.name === "AbortError") {
        setResult(null);
        return;
      }
      setResult(err instanceof Error ? err.message : "Query failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [loading, buildContext, setDatasetId, llmDisclosureAcknowledged]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") void handleSubmit(query);
  }, [query, handleSubmit]);

  if (!open) return null;

  return (
    <div
      data-testid="query-panel"
      className="query-panel"
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        background: "linear-gradient(to top, rgba(4,8,24,0.97) 0%, rgba(4,8,24,0.90) 100%)",
        borderTop: "1px solid rgba(0,229,255,0.18)",
        backdropFilter: "blur(12px)",
        padding: "12px 16px 16px",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        maxHeight: "50vh",
        overflowY: "auto",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 15, letterSpacing: "0.22em", color: "#00e5ff", opacity: 0.85, display: "flex", alignItems: "center" }}>
          ◈ NATURAL LANGUAGE QUERY
          <HelpIcon articleId="ai-assistant" label="AI assistant" />
        </span>
        <ViewscreenTooltip label="Close query panel (Esc)" side="left">
          <button
            onClick={onClose}
            style={{ fontSize: 16.5, color: "#94a3b8", cursor: "pointer", background: "none", border: "none", letterSpacing: "0.1em" }}
            aria-label="Close query panel"
          >
            ✕ ESC
          </button>
        </ViewscreenTooltip>
      </div>

      {/* LLM data-sharing disclosure — shown until the user dismisses it */}
      {!llmDisclosureAcknowledged && (
        <div
          data-testid="llm-disclosure-notice"
          style={{
            background: "rgba(251,146,60,0.07)",
            border: "1px solid rgba(251,146,60,0.35)",
            borderRadius: 4,
            padding: "9px 11px",
            marginBottom: 10,
            fontSize: 15,
            color: "#e2e8f0",
            lineHeight: 1.6,
            letterSpacing: "0.04em",
          }}
        >
          <div style={{ color: "#fb923c", fontWeight: 700, letterSpacing: "0.12em", marginBottom: 5 }}>
            ◈ AI QUERY — DATA NOTICE
          </div>
          When you submit a query, the following context is sent to a third-party AI service (Poe / OpenAI): your <strong style={{ color: "#fbbf24" }}>approximate camera location & depth</strong>, <strong style={{ color: "#fbbf24" }}>dataset name</strong>, dataset depth range, water type, and top habitat zone names. Raw sonar grid data is not transmitted. Queries are not stored after processing.
          <div style={{ marginTop: 8 }}>
            <button
              data-testid="llm-disclosure-acknowledge"
              onClick={() => setLlmDisclosureAcknowledged(true)}
              style={{
                background: "rgba(251,146,60,0.15)",
                border: "1px solid rgba(251,146,60,0.5)",
                borderRadius: 3,
                color: "#fb923c",
                fontFamily: "inherit",
                fontSize: 15,
                letterSpacing: "0.14em",
                padding: "4px 12px",
                cursor: "pointer",
              }}
            >
              UNDERSTOOD — ENABLE AI QUERIES
            </button>
          </div>
        </div>
      )}

      {/* Offline notice */}
      {!isOnline && (
        <div
          data-testid="query-offline-notice"
          style={{
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: 4,
            padding: "7px 10px",
            color: "#f87171",
            fontSize: 15,
            letterSpacing: "0.12em",
            marginBottom: 10,
          }}
        >
          No connection — natural language queries unavailable
        </div>
      )}

      {/* Input row */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          ref={inputRef}
          data-testid="query-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!isOnline}
          placeholder={isOnline ? "Ask anything about the terrain…" : "Offline — queries unavailable"}
          style={{
            flex: 1,
            background: isOnline ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)",
            border: `1px solid ${isOnline ? "rgba(0,229,255,0.2)" : "rgba(239,68,68,0.2)"}`,
            borderRadius: 4,
            color: isOnline ? "#e2e8f0" : "#94a3b8",
            fontSize: 18,
            padding: "7px 10px",
            outline: "none",
            fontFamily: "inherit",
            cursor: isOnline ? undefined : "not-allowed",
          }}
        />
        <ViewscreenTooltip label="Send your question to the assistant" side="top">
        <button
          data-testid="query-submit"
          onClick={() => void handleSubmit(query)}
          disabled={loading || !query.trim() || !isOnline || !llmDisclosureAcknowledged}
          style={{
            background: (loading || !isOnline || !llmDisclosureAcknowledged) ? "rgba(0,229,255,0.05)" : "rgba(0,229,255,0.12)",
            border: "1px solid rgba(0,229,255,0.3)",
            borderRadius: 4,
            color: (loading || !isOnline || !llmDisclosureAcknowledged) ? "#94a3b8" : "#00e5ff",
            fontSize: 15,
            letterSpacing: "0.18em",
            padding: "7px 14px",
            cursor: (loading || !isOnline || !llmDisclosureAcknowledged) ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            transition: "all 0.15s",
          }}
        >
          {loading ? "…" : "SUBMIT"}
        </button>
        </ViewscreenTooltip>
      </div>

      {/* Starter chips — shown when input is empty */}
      {!query && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {STARTER_QUERIES.map((q) => (
            <ViewscreenTooltip key={q} label="Try this example question" side="top">
            <button
              onClick={() => { setQuery(q); void handleSubmit(q); }}
              style={{
                background: "rgba(0,229,255,0.07)",
                border: "1px solid rgba(0,229,255,0.15)",
                borderRadius: 3,
                color: "#cbd5e1",
                fontSize: 13.5,
                padding: "4px 9px",
                cursor: "pointer",
                fontFamily: "inherit",
                letterSpacing: "0.1em",
                transition: "color 0.12s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#e2e8f0"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#cbd5e1"; }}
            >
              {q}
            </button>
            </ViewscreenTooltip>
          ))}
        </div>
      )}

      {/* Stat banner */}
      {statBanner && (
        <div
          data-testid="query-stat-banner"
          style={{
            marginBottom: 8,
            padding: "6px 10px",
            background: "rgba(0,229,255,0.08)",
            border: "1px solid rgba(0,229,255,0.2)",
            borderRadius: 4,
            fontSize: 16.5,
            color: "#00e5ff",
            letterSpacing: "0.12em",
          }}
        >
          {statBanner}
        </div>
      )}

      {/* Result banner */}
      {result && (
        <div
          data-testid="query-result"
          style={{
            marginBottom: 8,
            padding: "7px 10px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(100,116,139,0.3)",
            borderRadius: 4,
            fontSize: 16.5,
            color: "#e2e8f0",
            lineHeight: 1.5,
          }}
        >
          {result}
        </div>
      )}

      {/* Query history */}
      {history.length > 0 && (
        <div>
          <div style={{ fontSize: 13.5, color: "#64748b", letterSpacing: "0.2em", marginBottom: 5 }}>
            RECENT
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {history.map((h, i) => (
              <ViewscreenTooltip key={i} label="Run this past query again" side="top">
              <button
                onClick={() => { setQuery(h); void handleSubmit(h); }}
                style={{
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  color: "#94a3b8",
                  fontSize: 15,
                  padding: "2px 0",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  letterSpacing: "0.08em",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#cbd5e1"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8"; }}
              >
                ▸ {h}
              </button>
              </ViewscreenTooltip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
