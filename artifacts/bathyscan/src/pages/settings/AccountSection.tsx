import React, { useEffect, useRef, useState } from "react";
import { useUser, useClerk } from "@/lib/clerkCompat";
import { useDeleteMarkersMine } from "@workspace/api-client-react";
import { useSettingsStore } from "@/lib/settingsStore";
import { authorizedFetch } from "@/lib/authorizedFetch";
import { triggerBlobDownload } from "@/lib/blobDownload";
import { flushServerSync } from "@/hooks/useServerSettingsSync";
import { performSignOutCleanup } from "@/hooks/signoutCleanup";
import { useToast } from "@/hooks/use-toast";
import { S, FONT } from "./styles";
import { SectionTitle } from "./components/SectionTitle";
import { formatLastSynced } from "./constants";
import { AdminPanel } from "@/components/AdminPanel";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function AccountSection() {
  const { signOut } = useClerk();
  const { user, isSignedIn } = useUser();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const lastSyncedAt = useSettingsStore((s) => s.lastSyncedAt);
  const deleteAllMarkers = useDeleteMarkersMine({
    mutation: {
      onSuccess: () => {
        toast({ title: "All your markers deleted", duration: 4000 });
      },
      onError: () => {
        toast({ title: "Failed to delete markers", variant: "destructive", duration: 5000 });
      },
    },
  });

  const [exportingSettings, setExportingSettings] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [deleteMarkersUndo, setDeleteMarkersUndo] = useState<null | {
    message: string;
    timeoutId: ReturnType<typeof setTimeout>;
  }>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [accountDeleteMsg, setAccountDeleteMsg] = useState<string | null>(null);
  // True once the server DELETE has succeeded. From that point on the delete
  // button is removed from the DOM entirely — the account is gone, so a
  // "retry" would be meaningless (and confusing if sign-out then failed).
  const [accountDeleted, setAccountDeleted] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  // Single in-flight sign-out guard: double-clicks must not issue concurrent
  // Clerk signOut() calls. A ref (not state) so the guard is synchronous.
  const signOutInFlightRef = useRef(false);

  // The pending marker-deletion timer, kept in a ref so unmount cleanup and
  // the sign-out watcher can cancel it without depending on render state.
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live view of the auth state for the timeout callback: the setTimeout
  // closure would otherwise capture a stale `isSignedIn` from the render in
  // which the countdown started.
  const isSignedInRef = useRef<boolean>(!!isSignedIn);
  isSignedInRef.current = !!isSignedIn;

  // Cancel a pending marker-deletion countdown when the component unmounts.
  useEffect(() => {
    return () => {
      if (deleteTimerRef.current !== null) {
        clearTimeout(deleteTimerRef.current);
        deleteTimerRef.current = null;
      }
    };
  }, []);

  // Cancel a pending marker-deletion countdown if the user signs out before
  // it fires — the request would be unauthorized anyway.
  useEffect(() => {
    if (!isSignedIn && deleteTimerRef.current !== null) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
      setDeleteMarkersUndo(null);
    }
  }, [isSignedIn]);

  const handleExportSettings = () => {
    setExportingSettings(true);
    const settings = useSettingsStore.getState();
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
    triggerBlobDownload(blob, `bathyscan-settings-${Date.now()}.json`);
    setExportingSettings(false);
  };

  const handleExportAll = async () => {
    setExportingAll(true);
    try {
      const apiBase = basePath;
      const resp = await authorizedFetch(`${apiBase}/api/me/export`);
      if (!resp.ok) throw new Error("Export failed");
      const blob = await resp.blob();
      triggerBlobDownload(blob, `bathyscan-export-${Date.now()}.json`);
    } catch {
      toast({ title: "Export failed", variant: "destructive", duration: 5000 });
    }
    setExportingAll(false);
  };

  const handleImportSettings = async (file: File) => {
    setImportMsg(null);
    try {
      const text = await file.text();
      const raw = JSON.parse(text) as Record<string, unknown>;
      const current = useSettingsStore.getState();
      const merged: Record<string, unknown> = {};
      for (const key of Object.keys(current)) {
        if (key in raw) merged[key] = raw[key];
      }
      const { lastSyncedAt: _l, ...settingsToApply } = merged as {
        lastSyncedAt?: unknown;
        [k: string]: unknown;
      };
      useSettingsStore.setState(settingsToApply);
      void flushServerSync();
      setImportMsg("✓ Settings imported");
      toast({ title: "Settings imported", duration: 3000 });
    } catch {
      setImportMsg("✗ Invalid settings file");
      toast({ title: "Failed to import settings", variant: "destructive", duration: 5000 });
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleDeleteMarkers = () => {
    if (deleteMarkersUndo) return;
    if (!isSignedInRef.current) return;
    const id = setTimeout(() => {
      deleteTimerRef.current = null;
      setDeleteMarkersUndo(null);
      // Re-check auth at fire time: the user may have signed out (or the
      // session may have ended) during the 5-second countdown.
      if (!isSignedInRef.current) return;
      deleteAllMarkers.mutate(undefined);
    }, 5000);
    deleteTimerRef.current = id;
    setDeleteMarkersUndo({ message: "Deleting all markers in 5 s — tap UNDO to cancel", timeoutId: id });
  };

  const handleUndoDelete = () => {
    if (deleteMarkersUndo) {
      clearTimeout(deleteMarkersUndo.timeoutId);
      deleteTimerRef.current = null;
      setDeleteMarkersUndo(null);
    }
  };

  const handleDeleteAccount = async () => {
    if (!isSignedIn || !user || accountDeleted) return;
    if (!window.confirm("Permanently delete your BathyScan account and all data? This cannot be undone.")) {
      return;
    }
    setDeletingAccount(true);
    setAccountDeleteMsg(null);

    // ── Phase 1: server DELETE. Failures here mean the account still exists,
    // so the message must say whether a retry is safe.
    let res: Response;
    try {
      const apiBase = basePath;
      res = await authorizedFetch(`${apiBase}/api/me`, { method: "DELETE" });
    } catch {
      setAccountDeleteMsg(
        "✗ Network error — your account was NOT deleted. Check your connection and try again.",
      );
      setDeletingAccount(false);
      return;
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        setAccountDeleteMsg(
          "✗ Not authorized — your session may have expired. No data was deleted; sign in again before retrying.",
        );
      } else {
        setAccountDeleteMsg(
          `✗ Server error (${res.status}) — deletion did not complete. It is safe to retry.`,
        );
      }
      setDeletingAccount(false);
      return;
    }

    // ── Phase 2: server deletion succeeded. Clear all locally persisted
    // per-user state BEFORE attempting sign-out, so a delayed or failed
    // sign-out can't leave deleted-account data visible in the UI.
    setAccountDeleted(true);
    performSignOutCleanup();
    try {
      await signOut();
    } catch {
      // The account and its data are already gone — do NOT invite a retry.
      setAccountDeleteMsg(
        "✓ Account deleted. Sign-out failed — please close this tab. Do not retry deletion.",
      );
      setDeletingAccount(false);
    }
  };

  const handleSignOut = () => {
    if (signOutInFlightRef.current) return;
    signOutInFlightRef.current = true;
    setSigningOut(true);
    setSignOutError(null);
    void (async () => {
      try {
        await signOut();
      } catch {
        setSignOutError("Sign-out failed. Please try again.");
      } finally {
        signOutInFlightRef.current = false;
        setSigningOut(false);
      }
    })();
  };

  // Admin role comes from Clerk public metadata; the server independently
  // enforces access (ADMIN_USER_IDS), this only decides whether to render
  // the panel at all so ordinary users never see a 403 notice.
  const isAdminUser =
    (user?.publicMetadata as { role?: unknown } | undefined)?.role === "admin";

  return (
    <>
      <SectionTitle helpId="account" helpLabel="Account">◈ ACCOUNT</SectionTitle>

      {/* Profile card */}
      {user && (
        <div style={S.card}>
          <div style={S.cardHeader}>PROFILE</div>
          <div style={{ padding: "12px 16px", fontSize: "calc(10px * var(--bs-font-scale, 1))", color: "#cbd5e1" }}>
            <div style={{ marginBottom: 4 }}>
              <span style={{ color: "#94a3b8" }}>Name: </span>
              {user.fullName ?? (user as { username?: string }).username ?? "(none)"}
            </div>
            <div style={{ marginBottom: 4 }}>
              <span style={{ color: "#94a3b8" }}>Email: </span>
              {user.primaryEmailAddress?.emailAddress ?? "(none)"}
            </div>
            <div data-testid="last-synced-row">
              <span style={{ color: "#94a3b8" }}>LAST SYNCED: </span>
              <span style={{ color: lastSyncedAt ? "#e2e8f0" : "#94a3b8" }}>
                {lastSyncedAt ? formatLastSynced(lastSyncedAt) : "NEVER"}
              </span>
            </div>
          </div>
          <div style={{ padding: "0 16px 14px" }}>
            <button
              data-testid="settings-sign-out-btn"
              onClick={handleSignOut}
              disabled={signingOut}
              style={{
                background: "rgba(0,229,255,0.04)",
                border: "1px solid rgba(0,229,255,0.2)",
                borderRadius: 3,
                color: "#94a3b8",
                fontSize: "calc(9px * var(--bs-font-scale, 1))",
                letterSpacing: "0.15em",
                padding: "4px 12px",
                cursor: signingOut ? "default" : "pointer",
                opacity: signingOut ? 0.6 : 1,
                fontFamily: FONT,
              }}
            >
              {signingOut ? "SIGNING OUT…" : "SIGN OUT"}
            </button>
            {signOutError && (
              <div
                data-testid="sign-out-error"
                style={{ marginTop: 6, fontSize: "calc(10px * var(--bs-font-scale, 1))", color: "#f87171" }}
              >
                {signOutError}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Settings import/export */}
      <div style={S.card}>
        <div style={S.cardHeader}>SETTINGS BACKUP</div>
        <div style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: "calc(10px * var(--bs-font-scale, 1))", color: "#94a3b8", marginBottom: 12 }}>
            Export your settings as a JSON file and restore them on another device.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              data-testid="export-settings-btn"
              onClick={handleExportSettings}
              disabled={exportingSettings}
              style={{
                background: "rgba(0,229,255,0.06)",
                border: "1px solid rgba(0,229,255,0.25)",
                borderRadius: 3,
                color: "#67e8f9",
                fontSize: "calc(9px * var(--bs-font-scale, 1))",
                letterSpacing: "0.15em",
                padding: "4px 12px",
                cursor: "pointer",
                fontFamily: FONT,
              }}
            >
              {exportingSettings ? "EXPORTING…" : "EXPORT SETTINGS"}
            </button>
            {isSignedIn && (
              <button
                data-testid="export-all-btn"
                onClick={() => void handleExportAll()}
                disabled={exportingAll}
                style={{
                  background: "rgba(0,229,255,0.06)",
                  border: "1px solid rgba(0,229,255,0.25)",
                  borderRadius: 3,
                  color: "#67e8f9",
                  fontSize: "calc(9px * var(--bs-font-scale, 1))",
                  letterSpacing: "0.15em",
                  padding: "4px 12px",
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                {exportingAll ? "EXPORTING…" : "EXPORT ALL DATA"}
              </button>
            )}
            <button
              data-testid="import-settings-btn"
              onClick={() => fileRef.current?.click()}
              style={{
                background: "rgba(0,229,255,0.06)",
                border: "1px solid rgba(0,229,255,0.25)",
                borderRadius: 3,
                color: "#67e8f9",
                fontSize: "calc(9px * var(--bs-font-scale, 1))",
                letterSpacing: "0.15em",
                padding: "4px 12px",
                cursor: "pointer",
                fontFamily: FONT,
              }}
            >
              IMPORT SETTINGS
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportSettings(file);
              }}
            />
          </div>
          {importMsg && (
            <div style={{
              marginTop: 8, fontSize: "calc(10px * var(--bs-font-scale, 1))",
              color: importMsg.startsWith("✓") ? "#4ade80" : "#f87171",
            }}>
              {importMsg}
            </div>
          )}
        </div>
      </div>

      {/* Danger zone — only rendered while authenticated: destructive
          controls must never be actionable (or even visible) signed out. */}
      {isSignedIn && !!user && (
      <div style={{ ...S.dangerCard }}>
        <div style={S.dangerHeader}>DANGER ZONE</div>

        {/* Delete all markers */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(239,68,68,0.12)" }}>
          <div style={{ fontSize: "calc(10px * var(--bs-font-scale, 1))", color: "#94a3b8", marginBottom: 8 }}>
            Permanently delete all your markers from BathyScan.
          </div>
          {deleteMarkersUndo ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: "calc(10px * var(--bs-font-scale, 1))", color: "#fbbf24" }}>{deleteMarkersUndo.message}</span>
              <button
                data-testid="undo-delete-markers"
                onClick={handleUndoDelete}
                style={{
                  background: "rgba(251,191,36,0.12)",
                  border: "1px solid rgba(251,191,36,0.4)",
                  borderRadius: 3,
                  color: "#fbbf24",
                  fontSize: "calc(9px * var(--bs-font-scale, 1))",
                  letterSpacing: "0.12em",
                  padding: "3px 10px",
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                UNDO
              </button>
            </div>
          ) : (
            <button
              data-testid="delete-all-markers-btn"
              onClick={handleDeleteMarkers}
              disabled={deleteAllMarkers.isPending}
              style={{ ...S.dangerBtn, padding: "4px 12px", fontSize: "calc(9px * var(--bs-font-scale, 1))" }}
            >
              {deleteAllMarkers.isPending ? "DELETING…" : "DELETE ALL MY MARKERS"}
            </button>
          )}
        </div>

        {/* Delete account */}
        <div style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: "calc(10px * var(--bs-font-scale, 1))", color: "#94a3b8", marginBottom: 8 }}>
            Permanently delete your account, all markers, trails, and settings.
          </div>
          {!accountDeleted && (
            <button
              data-testid="delete-account-btn"
              onClick={() => void handleDeleteAccount()}
              disabled={deletingAccount}
              style={{ ...S.dangerBtn, padding: "4px 12px", fontSize: "calc(9px * var(--bs-font-scale, 1))" }}
            >
              {deletingAccount ? "DELETING…" : "DELETE ACCOUNT"}
            </button>
          )}
          {accountDeleteMsg && (
            <div
              data-testid="account-delete-msg"
              style={{
                marginTop: 8,
                fontSize: "calc(10px * var(--bs-font-scale, 1))",
                color: accountDeleted ? "#fbbf24" : "#f87171",
              }}
            >
              {accountDeleteMsg}
            </div>
          )}
        </div>
      </div>
      )}

      {/* Admin-only stats panel — rendered only for admin users so ordinary
          users never see a 403 notice they can't act on. */}
      {isAdminUser && (
        <div style={{ marginTop: 24 }}>
          <AdminPanel />
        </div>
      )}
    </>
  );
}
