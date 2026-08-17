/**
 * Settings page — thin shell that routes tabs to per-section components.
 *
 * Each of the 8 sections lives in ./settings/<Section>Section.tsx.
 * Shared widgets are in ./settings/components/.
 * Styles and constants are in ./settings/styles.ts and ./settings/constants.ts.
 *
 * Route: /settings   Keyboard shortcut: ,
 */
import React, { useEffect, useRef, useState, useCallback, useSyncExternalStore } from "react";
import { useLocation } from "wouter";
import { useUser } from "@/lib/clerkCompat";
import {
  flushServerSync,
  subscribeSettingsSyncStatus,
  getSettingsSyncStatus,
} from "@/hooks/useServerSettingsSync";
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
import { PaletteSection } from "./settings/PaletteSection";
import { NavigationSection } from "./settings/NavigationSection";
import { DisplayOverlaysSection } from "./settings/DisplayOverlaysSection";
import { MapLayersSection } from "./settings/MapLayersSection";
import { MarkerSymbolsSection } from "./settings/MarkerSymbolsSection";
import { DataStorageSection } from "./settings/DataStorageSection";
import { AccessibilitySection } from "./settings/AccessibilitySection";
import { AccountSection } from "./settings/AccountSection";

// ─── Tab ↔ URL search-param helpers ──────────────────────────────────────────
// The active tab is mirrored to `?tab=<id>` so specific sections are linkable
// and a refresh restores the section. Unknown or missing values fall back to
// the default "visuals" tab.
const DEFAULT_TAB: Tab = "visuals";

function isKnownTab(v: string | null): v is Tab {
  return v !== null && NAV_TABS.some((t) => t.id === v);
}

function readTabFromUrl(): Tab {
  try {
    const raw = new URLSearchParams(window.location.search).get("tab");
    return isKnownTab(raw) ? raw : DEFAULT_TAB;
  } catch {
    return DEFAULT_TAB;
  }
}

function writeTabToUrl(next: Tab): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    // replaceState (not pushState): tab switches must not stack history
    // entries, or the back button would step through every visited tab.
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    // URL mirroring is best-effort — never block a tab switch on it.
  }
}

export function Settings() {
  const [, setLocation] = useLocation();
  const { isSignedIn } = useUser();
  const [tab, setTab] = useState<Tab>(readTabFromUrl);
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

  const anyDirty = useAnySectionDirty();
  const shouldGuard = !!isSignedIn && anyDirty;

  // Keep a ref in sync so the unmount cleanup reads the CURRENT dirty state
  // instead of the stale value closed over when the effect mounted.
  const anyDirtyRef = useRef(anyDirty);
  useEffect(() => {
    anyDirtyRef.current = anyDirty;
  }, [anyDirty]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      // Only flush when there are unsaved changes: an unconditional flush on
      // every unmount fires redundant PUTs on clean unmounts (route switches
      // after everything saved, auth/layout remounts) and can race with the
      // destination page's own sync lifecycle.
      if (anyDirtyRef.current) void flushServerSync();
    };
  }, []);

  // Live sync status (debounce pending / PUT in flight / last attempt failed)
  // drives the three-state cloud indicator in the top bar.
  const syncStatus = useSyncExternalStore(
    subscribeSettingsSyncStatus,
    getSettingsSyncStatus,
  );
  const cloudState: "saving" | "error" | "synced" =
    syncStatus.lastSyncFailed && !syncStatus.syncing
      ? "error"
      : anyDirty || syncStatus.syncing
        ? "saving"
        : "synced";

  const syncCtx = React.useMemo(
    () => ({ flush: flushSync, isSignedIn: !!isSignedIn }),
    [flushSync, isSignedIn],
  );

  const showAdvancedEverywhere = useSettingsStore((s) => s.showAdvancedEverywhere);
  const setShowAdvancedEverywhere = useSettingsStore((s) => s.setShowAdvancedEverywhere);

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
        // Swallow — user can retry via the sync indicator or section Save.
      }
    }
    // Return to wherever Settings was opened from (dataset page, deep link,
    // another view). Fall back to the app root only when this is the first
    // history entry (e.g. a direct /settings navigation in a fresh tab).
    if (window.history.length > 1) {
      window.history.back();
    } else {
      setLocation(basePath + "/");
    }
  }, [shouldGuard, flushSync, setLocation]);

  const handleTabSelect = useCallback(
    (next: Tab) => {
      if (next === tab) return;
      if (shouldGuard) {
        // Same policy as the back button: auto-flush unsaved changes before
        // the current section unmounts. The switch is optimistic; a failed
        // flush surfaces through the "save failed" indicator, not a blocker.
        void flushSync().catch(() => {
          /* surfaced via the sync-status indicator */
        });
      }
      setTab(next);
      writeTabToUrl(next);
    },
    [tab, shouldGuard, flushSync],
  );

  return (
    <SyncContext.Provider value={syncCtx}>
      <div style={S.page} className="bs-settings-page">
        {/* Top bar */}
        <div style={S.topbar} className="bs-settings-topbar">
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
              fontSize: "calc(11px * var(--bs-font-scale, 1))",
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
                style={{ fontSize: "calc(9px * var(--bs-font-scale, 1))", letterSpacing: "0.15em", color: "#fbbf24", opacity: 0.8 }}
              >
                • UNSAVED
              </span>
            )}
          </button>
          <span
            style={{
              fontSize: "calc(10px * var(--bs-font-scale, 1))",
              letterSpacing: "0.3em",
              color: "#00e5ff",
              fontWeight: 700,
              textShadow: "0 0 8px rgba(0,229,255,0.5)",
              flex: 1,
            }}
          >
            SETTINGS
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: "calc(9px * var(--bs-font-scale, 1))" }} className="bs-settings-topbar-actions">
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
            {isSignedIn && !savedMsg && cloudState === "saving" && (
              <span
                data-testid="topbar-sync-status"
                data-sync-state="saving"
                style={{ color: "#fbbf24", letterSpacing: "0.1em" }}
              >
                saving…
              </span>
            )}
            {isSignedIn && !savedMsg && cloudState === "error" && (
              <span
                data-testid="topbar-sync-status"
                data-sync-state="error"
                style={{
                  color: "#f87171",
                  letterSpacing: "0.1em",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                save failed
                <button
                  data-testid="topbar-sync-retry"
                  onClick={() => {
                    void flushSync().catch(() => {
                      /* stays in the error state; the user can retry again */
                    });
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "#00e5ff",
                    cursor: "pointer",
                    fontFamily: FONT,
                    fontSize: "inherit",
                    letterSpacing: "0.1em",
                    textDecoration: "underline",
                  }}
                >
                  retry
                </button>
              </span>
            )}
            {isSignedIn && !savedMsg && cloudState === "synced" && (
              <span
                data-testid="topbar-sync-status"
                data-sync-state="synced"
                style={{ color: "#64748b", letterSpacing: "0.1em" }}
              >
                synced to cloud
              </span>
            )}
            <span
              style={{ color: "#64748b", letterSpacing: "0.1em" }}
              title={`schema v${SETTINGS_SCHEMA_VERSION}`}
              className="bs-settings-version"
            >
              v{SETTINGS_SCHEMA_VERSION}
            </span>
          </div>
        </div>

        {/* Two-column layout */}
        <div style={S.layout} className="bs-settings-layout">
          {/* Sidebar */}
          <nav style={S.sidebar} className="bs-settings-sidebar" aria-label="Settings sections">
            {NAV_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => handleTabSelect(t.id)}
                style={S.navItem(tab === t.id)}
                data-nav-active={tab === t.id ? "true" : "false"}
                aria-current={tab === t.id ? "page" : undefined}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div style={S.content} className="bs-settings-content">
            {tab === "general" && <GeneralSection />}
            {tab === "visuals" && <VisualsSection />}
            {tab === "palette" && <PaletteSection />}
            {tab === "navigation" && <NavigationSection />}
            {tab === "display-overlays" && <DisplayOverlaysSection />}
            {tab === "map-layers" && <MapLayersSection />}
            {tab === "marker-symbols" && <MarkerSymbolsSection />}
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
