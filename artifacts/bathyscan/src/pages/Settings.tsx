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
import { useUser, useClerk } from "@/lib/clerkCompat";
import { authorizedFetch } from "@/lib/authorizedFetch";
import { useHelpStore } from "@/lib/helpStore";
import { useIsMobile } from "@/hooks/use-mobile";
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
import { ADMIN_NAV_TAB, NAV_TABS, MOBILE_NAV_TABS, type Tab, basePath } from "./settings/constants";
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
import { AdminSection } from "./settings/AdminSection";
// MOBILE-ONLY: dedicated 2D Chart section (never rendered on desktop)
import { ChartMapSection } from "./settings/ChartMapSection";

// ─── Tab ↔ URL search-param helpers ──────────────────────────────────────────
// The active tab is mirrored to `?tab=<id>` so specific sections are linkable
// and a refresh restores the section. Unknown or missing values fall back to
// the default "visuals" tab.
const DEFAULT_TAB: Tab = "visuals";

function isKnownTab(v: string | null): v is Tab {
  // MOBILE-ONLY: "chart-map" is a valid tab on mobile; accept it for URL
  // restore so a reload on mobile doesn't fall back to the default tab.
  return v !== null && (
    NAV_TABS.some((t) => t.id === v) ||
    v === "chart-map" ||
    v === "admin"
  );
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
  const { isSignedIn, isLoaded, user } = useUser();
  const { signOut } = useClerk();
  const openHelp = useHelpStore((s) => s.openHelp);
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<Tab>(readTabFromUrl);
  const [savedMsg, setSavedMsg] = useState(false);
  const authLoaded = isLoaded !== false;
  const [adminAccess, setAdminAccess] = useState<
    "checking" | "allowed" | "denied" | "error"
  >("checking");
  const [adminProbeAttempt, setAdminProbeAttempt] = useState(0);
  const isAdminUser = adminAccess === "allowed";
  const visibleTabs = [
    ...(isMobile ? MOBILE_NAV_TABS : NAV_TABS),
    ...(isAdminUser ? [ADMIN_NAV_TAB] : []),
  ];
  // Never mount admin UI for a manually-entered URL when the client has no
  // admin claim. The effect below also normalizes the link back to the default.
  const activeTab =
    tab === "admin" && adminAccess !== "allowed" && adminAccess !== "error"
      ? DEFAULT_TAB
      : tab;

  // Confirm discoverability against the same server policy that protects the
  // operations. Clerk metadata is deliberately not used as an authority: an
  // ADMIN_USER_IDS allowlisted operator may not have a duplicated role claim.
  useEffect(() => {
    if (!authLoaded) return;
    if (!isSignedIn) {
      setAdminAccess("denied");
      return;
    }
    let cancelled = false;
    setAdminAccess("checking");
    void authorizedFetch(`${basePath}/api/admin/users/pending-count`)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setAdminAccess("allowed");
        else if (res.status === 401 || res.status === 403) setAdminAccess("denied");
        else setAdminAccess("error");
      })
      .catch(() => {
        if (!cancelled) setAdminAccess("error");
      });
    return () => {
      cancelled = true;
    };
  }, [adminProbeAttempt, authLoaded, isSignedIn, user?.id]);

  useEffect(() => {
    if (adminAccess === "denied" && tab === "admin") {
      setTab(DEFAULT_TAB);
      writeTabToUrl(DEFAULT_TAB);
    }
  }, [adminAccess, tab]);

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

        {/* Mobile auth + help block — shown above the tab strip on phones.
            Signed-out users see Sign In; signed-in users see their email + Sign Out.
            A Help shortcut is always shown. Desktop keeps its own header controls. */}
        {isMobile && (
          <div
            data-testid="mobile-auth-block"
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 10,
              padding: "10px 16px",
              borderBottom: "1px solid rgba(0,229,255,0.1)",
              background: "rgba(4,8,16,0.6)",
              fontFamily: FONT,
            }}
          >
            {isSignedIn && user ? (
              <div
                data-testid="mobile-auth-signed-in"
                style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}
              >
                <span
                  data-testid="mobile-auth-email"
                  style={{
                    fontSize: "calc(9px * var(--bs-font-scale, 1))",
                    color: "#94a3b8",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {(user as { primaryEmailAddress?: { emailAddress: string } })
                    .primaryEmailAddress?.emailAddress ?? ""}
                </span>
                <button
                  data-testid="mobile-settings-sign-out-btn"
                  onClick={() => void signOut()}
                  style={{
                    background: "rgba(0,229,255,0.04)",
                    border: "1px solid rgba(0,229,255,0.2)",
                    borderRadius: 3,
                    color: "#94a3b8",
                    fontSize: "calc(9px * var(--bs-font-scale, 1))",
                    letterSpacing: "0.15em",
                    padding: "4px 10px",
                    cursor: "pointer",
                    fontFamily: FONT,
                    whiteSpace: "nowrap",
                  }}
                >
                  SIGN OUT
                </button>
              </div>
            ) : (
              <button
                data-testid="mobile-settings-sign-in-btn"
                onClick={() => setLocation(basePath + "/sign-in")}
                style={{
                  background: "rgba(0,229,255,0.08)",
                  border: "1px solid rgba(0,229,255,0.35)",
                  borderRadius: 4,
                  color: "#00e5ff",
                  fontSize: "calc(9px * var(--bs-font-scale, 1))",
                  letterSpacing: "0.15em",
                  padding: "6px 14px",
                  cursor: "pointer",
                  fontFamily: FONT,
                  flex: 1,
                }}
              >
                SIGN IN
              </button>
            )}
            <button
              data-testid="mobile-settings-help-btn"
              onClick={() => openHelp()}
              style={{
                background: "rgba(0,229,255,0.04)",
                border: "1px solid rgba(0,229,255,0.2)",
                borderRadius: 3,
                color: "#00e5ff",
                fontSize: "calc(9px * var(--bs-font-scale, 1))",
                letterSpacing: "0.15em",
                padding: "4px 10px",
                cursor: "pointer",
                fontFamily: FONT,
                whiteSpace: "nowrap",
              }}
            >
              ? HELP
            </button>
          </div>
        )}

        {/* Two-column layout */}
        <div style={S.layout} className="bs-settings-layout">
          {/* Sidebar */}
          <nav style={S.sidebar} className="bs-settings-sidebar" aria-label="Settings sections">
            {/* MOBILE-ONLY: phone tab strip includes the "2D Chart" tab;
                desktop always renders the original NAV_TABS unchanged. */}
            {visibleTabs.map((t) => (
              <button
                key={t.id}
                onClick={() => handleTabSelect(t.id)}
                style={S.navItem(activeTab === t.id)}
                data-nav-active={activeTab === t.id ? "true" : "false"}
                data-testid={`settings-nav-${t.id}`}
                aria-current={activeTab === t.id ? "page" : undefined}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div style={S.content} className="bs-settings-content">
            {activeTab === "general" && <GeneralSection />}
            {activeTab === "visuals" && <VisualsSection />}
            {activeTab === "palette" && <PaletteSection />}
            {activeTab === "navigation" && <NavigationSection />}
            {activeTab === "display-overlays" && <DisplayOverlaysSection />}
            {activeTab === "map-layers" && <MapLayersSection />}
            {activeTab === "marker-symbols" && <MarkerSymbolsSection />}
            {activeTab === "data-storage" && <DataStorageSection />}
            {activeTab === "accessibility" && <AccessibilitySection />}
            {activeTab === "account" && <AccountSection />}
            {activeTab === "admin" && isAdminUser && <AdminSection />}
            {activeTab === "admin" && adminAccess === "error" && (
              <section data-testid="admin-access-error">
                <div style={S.card}>
                  <div style={S.cardHeader}>ADMIN ACCESS UNAVAILABLE</div>
                  <div style={{ padding: "14px 16px" }}>
                    <p style={{ ...S.sublabel, marginTop: 0 }}>
                      BathyScan could not verify administrator access. No admin
                      data has been loaded.
                    </p>
                    <button
                      data-testid="admin-access-retry"
                      onClick={() => setAdminProbeAttempt((attempt) => attempt + 1)}
                      style={{
                        background: "rgba(0,229,255,0.06)",
                        border: "1px solid rgba(0,229,255,0.25)",
                        borderRadius: 3,
                        color: "#67e8f9",
                        fontFamily: FONT,
                        fontSize: "calc(9px * var(--bs-font-scale, 1))",
                        letterSpacing: "0.15em",
                        padding: "5px 12px",
                        cursor: "pointer",
                      }}
                    >
                      RETRY
                    </button>
                  </div>
                </div>
              </section>
            )}
            {/* MOBILE-ONLY: 2D Chart section — only reachable via the mobile tab strip */}
            {activeTab === "chart-map" && <ChartMapSection />}

            {/* Footer: global reset */}
            <GlobalResetFooter />
          </div>
        </div>
      </div>
    </SyncContext.Provider>
  );
}
