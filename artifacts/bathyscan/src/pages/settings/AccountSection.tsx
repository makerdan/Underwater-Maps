import React, { useRef, useState } from "react";
import { useUser, useClerk } from "@/lib/clerkCompat";
import { useDeleteMarkersMine } from "@workspace/api-client-react";
import { useSettingsStore } from "@/lib/settingsStore";
import { authorizedFetch } from "@/lib/authorizedFetch";
import { triggerBlobDownload } from "@/lib/blobDownload";
import { flushServerSync } from "@/hooks/useServerSettingsSync";
import { useToast } from "@/hooks/use-toast";
import { S } from "./styles";
import { FONT } from "./styles";
import { SectionTitle } from "./components/SectionTitle";
import { formatLastSynced } from "./constants";

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
    const id = setTimeout(() => {
      setDeleteMarkersUndo(null);
      deleteAllMarkers.mutate(undefined);
    }, 5000);
    setDeleteMarkersUndo({ message: "Deleting all markers in 5 s — tap UNDO to cancel", timeoutId: id });
  };

  const handleUndoDelete = () => {
    if (deleteMarkersUndo) {
      clearTimeout(deleteMarkersUndo.timeoutId);
      setDeleteMarkersUndo(null);
    }
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm("Permanently delete your BathyScan account and all data? This cannot be undone.")) {
      return;
    }
    setDeletingAccount(true);
    setAccountDeleteMsg(null);
    try {
      const apiBase = basePath;
      const res = await authorizedFetch(`${apiBase}/api/me`, { method: "DELETE" });
      if (!res.ok) throw new Error("Server returned " + res.status);
      await signOut();
    } catch {
      setAccountDeleteMsg("✗ Deletion failed. Contact support.");
      setDeletingAccount(false);
    }
  };

  return (
    <>
      <SectionTitle helpId="account" helpLabel="Account">◈ ACCOUNT</SectionTitle>

      {/* Profile card */}
      {user && (
        <div style={S.card}>
          <div style={S.cardHeader}>PROFILE</div>
          <div style={{ padding: "12px 16px", fontSize: 10, color: "#cbd5e1" }}>
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
              onClick={() => void signOut()}
              style={{
                background: "rgba(0,229,255,0.04)",
                border: "1px solid rgba(0,229,255,0.2)",
                borderRadius: 3,
                color: "#94a3b8",
                fontSize: 9,
                letterSpacing: "0.15em",
                padding: "4px 12px",
                cursor: "pointer",
                fontFamily: FONT,
              }}
            >
              SIGN OUT
            </button>
          </div>
        </div>
      )}

      {/* Settings import/export */}
      <div style={S.card}>
        <div style={S.cardHeader}>SETTINGS BACKUP</div>
        <div style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 12 }}>
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
                fontSize: 9,
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
                  fontSize: 9,
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
                fontSize: 9,
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
              marginTop: 8, fontSize: 10,
              color: importMsg.startsWith("✓") ? "#4ade80" : "#f87171",
            }}>
              {importMsg}
            </div>
          )}
        </div>
      </div>

      {/* Danger zone */}
      <div style={{ ...S.dangerCard }}>
        <div style={S.dangerHeader}>DANGER ZONE</div>

        {/* Delete all markers */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(239,68,68,0.12)" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 8 }}>
            Permanently delete all your markers from BathyScan.
          </div>
          {deleteMarkersUndo ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: "#fbbf24" }}>{deleteMarkersUndo.message}</span>
              <button
                data-testid="undo-delete-markers"
                onClick={handleUndoDelete}
                style={{
                  background: "rgba(251,191,36,0.12)",
                  border: "1px solid rgba(251,191,36,0.4)",
                  borderRadius: 3,
                  color: "#fbbf24",
                  fontSize: 9,
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
              style={{ ...S.dangerBtn, padding: "4px 12px", fontSize: 9 }}
            >
              {deleteAllMarkers.isPending ? "DELETING…" : "DELETE ALL MY MARKERS"}
            </button>
          )}
        </div>

        {/* Delete account */}
        <div style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 8 }}>
            Permanently delete your account, all markers, trails, and settings.
          </div>
          <button
            data-testid="delete-account-btn"
            onClick={() => void handleDeleteAccount()}
            disabled={deletingAccount}
            style={{ ...S.dangerBtn, padding: "4px 12px", fontSize: 9 }}
          >
            {deletingAccount ? "DELETING…" : "DELETE ACCOUNT"}
          </button>
          {accountDeleteMsg && (
            <div style={{ marginTop: 8, fontSize: 10, color: "#f87171" }}>{accountDeleteMsg}</div>
          )}
        </div>
      </div>
    </>
  );
}
