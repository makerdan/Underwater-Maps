/**
 * Settings page — thin shell that routes tabs to per-section components.
 *
 * Each of the 8 sections lives in ./settings/<Section>Section.tsx.
 * Shared widgets are in ./settings/components/.
 * Styles and constants are in ./settings/styles.ts and ./settings/constants.ts.
 *
 * Route: /settings   Keyboard shortcut: ,
 */
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useUser } from "@/lib/clerkCompat";
import { flushServerSync } from "@/hooks/useServerSettingsSync";
import {
  useSettingsStore,
  useAnySectionDirty,
  SETTINGS_SCHEMA_VERSION,
} from "@/lib/settingsStore";

import { S, FONT } from "./settings/styles";
import { NAV_TABS, type Tab, basePath } from "./settings/constants";
import { SyncContext } from "./settings/components/SyncContext";
import { Toggle } from "./settings/components/Toggle";
import { GlobalResetFooter } from "./settings/components/GlobalResetFooter";

import { GeneralSection } from "./settings/GeneralSection";
import { VisualsSection } from "./settings/VisualsSection";
import { NavigationSection } from "./settings/NavigationSection";
import { DisplayOverlaysSection } from "./settings/DisplayOverlaysSection";
import { MapLayersSection } from "./settings/MapLayersSection";
import { DataStorageSection } from "./settings/DataStorageSection";
import { AccessibilitySection } from "./settings/AccessibilitySection";
import { AccountSection } from "./settings/AccountSection";

export function Settings() {
  const [, setLocation] = useLocation();
  const { isSignedIn } = useUser();
  const [tab, setTab] = useState<Tab>("visuals");
  const [savedMsg, setSavedMsg] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashSavedMsg = useCallback(() => {
    setSavedMsg(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSavedMsg(false), 2000);
  }, []);

  const markAllSaved = useSettingsStore((s) => s.markAllSaved);

  const flushSync = useCallback(async (): Promise<void> => {
    if (!isSignedIn) {
      markAllSaved(null);
      flashSavedMsg();
      return;
    }
    await flushServerSync();
    flashSavedMsg();
  }, [isSignedIn, markAllSaved, flashSavedMsg]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      void flushServerSync();
    };
  }, []);

  const syncCtx = React.useMemo(
    () => ({ flush: flushSync, isSignedIn: !!isSignedIn }),
    [flushSync, isSignedIn],
  );

  const showAdvancedEverywhere = useSettingsStore((s) => s.showAdvancedEverywhere);
  const setShowAdvancedEverywhere = useSettingsStore((s) => s.setShowAdvancedEverywhere);

  const anyDirty = useAnySectionDirty();
  const shouldGuard = !!isSignedIn && anyDirty;

  useEffect(() => {
    if (!shouldGuard) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [shouldGuard]);

  const handleBack = useCallback(async () => {
    if (shouldGuard) {
      try {
        await flushSync();
      } catch {
        // Swallow — user can retry via the section Save button.
      }
    }
    setLocation(basePath + "/");
  }, [shouldGuard, flushSync, setLocation]);

  return (
    <SyncContext.Provider value={syncCtx}>
      <div style={S.page} className="bs-settings-page">
        {/* Top bar */}
        <div style={S.topbar}>
          <button
            onClick={() => void handleBack()}
            title={shouldGuard ? "Saving unsaved changes before leaving…" : undefined}
            data-testid="settings-back-btn"
            data-unsaved={shouldGuard ? "true" : "false"}
            style={{
              background: "none",
              border: "none",
              color: shouldGuard ? "#fbbf24" : "#94a3b8",
              cursor: "pointer",
              fontSize: 11,
              letterSpacing: "0.15em",
              padding: 0,
              fontFamily: FONT,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>← BACK</span>
            {shouldGuard && (
              <span
                data-testid="settings-back-unsaved-hint"
                style={{ fontSize: 9, letterSpacing: "0.15em", color: "#fbbf24", opacity: 0.8 }}
              >
                • UNSAVED
              </span>
            )}
          </button>
          <span
            style={{
              fontSize: 10,
              letterSpacing: "0.3em",
              color: "#00e5ff",
              fontWeight: 700,
              textShadow: "0 0 8px rgba(0,229,255,0.5)",
              flex: 1,
            }}
          >
            SETTINGS
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 9 }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "#cbd5e1",
                letterSpacing: "0.1em",
                cursor: "pointer",
              }}
            >
              <span>SHOW ADVANCED</span>
              <span data-testid="show-advanced-toggle">
                <Toggle value={showAdvancedEverywhere} onChange={setShowAdvancedEverywhere} />
              </span>
            </label>
            {savedMsg && (
              <span
                data-testid="topbar-saved-indicator"
                style={{ color: "#4ade80", letterSpacing: "0.15em" }}
              >
                ✓ SAVED
              </span>
            )}
            {isSignedIn && !savedMsg && (
              <span style={{ color: "#64748b", letterSpacing: "0.1em" }}>synced to cloud</span>
            )}
            <span
              style={{ color: "#64748b", letterSpacing: "0.1em" }}
              title={`schema v${SETTINGS_SCHEMA_VERSION}`}
            >
              v{SETTINGS_SCHEMA_VERSION}
            </span>
          </div>
        </div>

        {/* Two-column layout */}
        <div style={S.layout}>
          {/* Sidebar */}
          <nav style={S.sidebar}>
            {NAV_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={S.navItem(tab === t.id)}
                data-nav-active={tab === t.id ? "true" : "false"}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div style={S.content}>
            {tab === "general" && <GeneralSection />}
            {tab === "visuals" && <VisualsSection />}
            {tab === "navigation" && <NavigationSection />}
            {tab === "display-overlays" && <DisplayOverlaysSection />}
            {tab === "map-layers" && <MapLayersSection />}
            {tab === "data-storage" && <DataStorageSection />}
            {tab === "accessibility" && <AccessibilitySection />}
            {tab === "account" && <AccountSection />}

            {/* Footer: global reset */}
            <GlobalResetFooter />
          </div>
        </div>
      </div>
    </SyncContext.Provider>
  );
}
