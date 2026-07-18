/**
 * CatchJournalPanel — the catch journal for a single marker ("spot").
 *
 * Opened via the marker context menu's "Catch journal" action. Lists the
 * marker's catch entries and lets the user add, edit, and delete entries.
 * Each entry has a symbol (searchable emoji picker), free-text notes, and up
 * to MAX_PHOTOS photos uploaded straight to private object storage via
 * short-lived signed URLs (server sets per-user ACLs).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMarkersMarkerIdCatches,
  getGetMarkersMarkerIdCatchesQueryKey,
  usePostMarkersMarkerIdCatches,
  usePatchCatchesId,
  useDeleteCatchesId,
  postCatchPhotosUploadUrl,
  getGetCatchesQueryKey,
} from "@workspace/api-client-react";
import type { CatchEntry } from "@workspace/api-client-react";
import { useCatchJournalStore } from "@/lib/catchJournalStore";
import {
  searchCatchSymbols,
  CATCH_SYMBOL_CATEGORIES,
  type CatchSymbol,
} from "@/lib/catchSymbols";
const MONO: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
};

const MAX_PHOTOS = 6;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** Photo object paths are "/objects/…" — served by the API under /api. */
export function photoSrc(objectPath: string): string {
  const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
  return `${base}/api${objectPath}`;
}

// ---------------------------------------------------------------------------
// Symbol picker
// ---------------------------------------------------------------------------

interface SymbolPickerProps {
  value: string;
  onPick: (s: CatchSymbol) => void;
}

export const CatchSymbolPicker: React.FC<SymbolPickerProps> = ({ value, onPick }) => {
  const [query, setQuery] = useState("");
  const results = searchCatchSymbols(query);

  return (
    <div data-testid="catch-symbol-picker">
      <input
        type="text"
        data-testid="catch-symbol-search"
        placeholder="Search symbols… (e.g. salmon, crab, trophy)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "rgba(0,229,255,0.05)",
          border: "1px solid rgba(0,229,255,0.25)",
          borderRadius: 3,
          color: "#e2e8f0",
          padding: "6px 8px",
          fontSize: 14,
          marginBottom: 6,
          ...MONO,
        }}
      />
      <div
        style={{
          maxHeight: 170,
          overflowY: "auto",
          border: "1px solid rgba(0,229,255,0.12)",
          borderRadius: 3,
          padding: 6,
          background: "rgba(0,10,20,0.5)",
        }}
      >
        {results.length === 0 && (
          <div style={{ color: "#94a3b8", fontSize: 13, padding: 6 }}>
            No symbols match “{query}”
          </div>
        )}
        {CATCH_SYMBOL_CATEGORIES.map((cat) => {
          const inCat = results.filter((s) => s.category === cat);
          if (inCat.length === 0) return null;
          return (
            <div key={cat} style={{ marginBottom: 6 }}>
              <div style={{ color: "#64748b", fontSize: 11, letterSpacing: "0.12em", marginBottom: 3 }}>
                {cat.toUpperCase()}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                {inCat.map((s) => (
                  <button
                    key={s.symbol}
                    type="button"
                    title={s.name}
                    data-testid={`catch-symbol-${s.name.replace(/\s+/g, "-").toLowerCase()}`}
                    onClick={() => onPick(s)}
                    style={{
                      fontSize: 20,
                      lineHeight: "26px",
                      width: 32,
                      height: 32,
                      background: value === s.symbol ? "rgba(0,229,255,0.25)" : "transparent",
                      border: value === s.symbol
                        ? "1px solid rgba(0,229,255,0.6)"
                        : "1px solid transparent",
                      borderRadius: 3,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    {s.symbol}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Photo upload
// ---------------------------------------------------------------------------

interface UploadingPhoto {
  name: string;
  progress: number; // 0..100
}

/** Validate a candidate file; returns an error message or null. */
export function validatePhotoFile(file: { type: string; size: number }): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return "Only JPEG, PNG, WebP, or GIF images are allowed";
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return "Photo is too large (max 10 MB)";
  }
  return null;
}

/**
 * Upload one photo: request a signed URL from the API, PUT the file bytes
 * directly to object storage with progress callbacks, return the normalized
 * "/objects/…" path to store on the catch entry.
 */
async function uploadPhoto(
  file: File,
  onProgress: (pct: number) => void,
): Promise<string> {
  const { uploadURL, objectPath } = await postCatchPhotosUploadUrl();
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadURL);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed (network error)"));
    xhr.send(file);
  });
  return objectPath;
}

// ---------------------------------------------------------------------------
// Entry form (create + edit)
// ---------------------------------------------------------------------------

interface EntryFormProps {
  initial?: CatchEntry;
  busy: boolean;
  onSubmit: (data: { symbol: string; symbolName: string; notes: string | null; photos: string[] }) => void;
  onCancel: () => void;
}

const CatchEntryForm: React.FC<EntryFormProps> = ({ initial, busy, onSubmit, onCancel }) => {
  const [symbol, setSymbol] = useState(initial?.symbol ?? "");
  const [symbolName, setSymbolName] = useState(initial?.symbolName ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [photos, setPhotos] = useState<string[]>(initial?.photos ?? []);
  const [uploading, setUploading] = useState<UploadingPhoto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    // Track the live count locally: `photos.length` is stale inside this async
    // loop, which previously allowed uploading extra files beyond MAX_PHOTOS.
    let count = photos.length;
    for (const file of Array.from(files)) {
      if (count >= MAX_PHOTOS) {
        setError(`At most ${MAX_PHOTOS} photos per catch`);
        break;
      }
      const invalid = validatePhotoFile(file);
      if (invalid) {
        setError(invalid);
        continue;
      }
      setUploading({ name: file.name, progress: 0 });
      try {
        const path = await uploadPhoto(file, (pct) =>
          setUploading({ name: file.name, progress: pct }),
        );
        count += 1;
        setPhotos((prev) => (prev.length < MAX_PHOTOS ? [...prev, path] : prev));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(null);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [photos.length]);

  const canSubmit = symbol.length > 0 && !busy && !uploading;

  return (
    <div
      data-testid="catch-entry-form"
      style={{
        border: "1px solid rgba(0,229,255,0.2)",
        borderRadius: 4,
        padding: 10,
        marginBottom: 10,
        background: "rgba(0,229,255,0.03)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 26, minWidth: 32, textAlign: "center" }}>
          {symbol || "·"}
        </span>
        <span style={{ color: symbol ? "#e2e8f0" : "#64748b", fontSize: 14 }}>
          {symbol ? symbolName || "Selected" : "Pick a symbol below"}
        </span>
      </div>

      <CatchSymbolPicker
        value={symbol}
        onPick={(s) => {
          setSymbol(s.symbol);
          setSymbolName(s.name);
        }}
      />

      <textarea
        data-testid="catch-notes-input"
        placeholder="Notes — species, size, bait, conditions…"
        value={notes}
        onChange={(e) => setNotes(e.target.value.slice(0, 1000))}
        rows={3}
        style={{
          width: "100%",
          boxSizing: "border-box",
          marginTop: 8,
          background: "rgba(0,229,255,0.05)",
          border: "1px solid rgba(0,229,255,0.25)",
          borderRadius: 3,
          color: "#e2e8f0",
          padding: "6px 8px",
          fontSize: 14,
          resize: "vertical",
          ...MONO,
        }}
      />

      {/* Photos */}
      <div style={{ marginTop: 8 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {photos.map((p) => (
            <div key={p} style={{ position: "relative" }}>
              <img
                src={photoSrc(p)}
                alt="Catch photo"
                style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 3, border: "1px solid rgba(0,229,255,0.25)" }}
              />
              <button
                type="button"
                aria-label="Remove photo"
                onClick={() => setPhotos((prev) => prev.filter((x) => x !== p))}
                style={{
                  position: "absolute",
                  top: -6,
                  right: -6,
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  border: "none",
                  background: "#dc2626",
                  color: "#fff",
                  fontSize: 11,
                  lineHeight: "18px",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                ✕
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <button
              type="button"
              data-testid="catch-photo-add"
              onClick={() => fileInputRef.current?.click()}
              disabled={!!uploading}
              style={{
                width: 56,
                height: 56,
                border: "1px dashed rgba(0,229,255,0.4)",
                borderRadius: 3,
                background: "transparent",
                color: "#22d3ee",
                fontSize: 22,
                cursor: uploading ? "wait" : "pointer",
              }}
            >
              {uploading ? `${uploading.progress}%` : "+"}
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          multiple
          style={{ display: "none" }}
          onChange={(e) => void handleFiles(e.target.files)}
          data-testid="catch-photo-input"
        />
      </div>

      {error && (
        <div data-testid="catch-form-error" style={{ color: "#fca5a5", fontSize: 13, marginTop: 6 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          type="button"
          data-testid="catch-form-save"
          disabled={!canSubmit}
          onClick={() =>
            onSubmit({
              symbol,
              symbolName,
              notes: notes.trim().length > 0 ? notes.trim() : null,
              photos,
            })
          }
          style={{
            flex: 1,
            background: canSubmit ? "rgba(0,229,255,0.15)" : "rgba(100,116,139,0.1)",
            border: "1px solid rgba(0,229,255,0.4)",
            color: canSubmit ? "#22d3ee" : "#64748b",
            borderRadius: 3,
            padding: "6px 0",
            cursor: canSubmit ? "pointer" : "not-allowed",
            fontSize: 14,
            ...MONO,
          }}
        >
          {busy ? "Saving…" : initial ? "Save changes" : "Log catch"}
        </button>
        <button
          type="button"
          data-testid="catch-form-cancel"
          onClick={onCancel}
          style={{
            background: "none",
            border: "1px solid rgba(148,163,184,0.3)",
            color: "#94a3b8",
            borderRadius: 3,
            padding: "6px 12px",
            cursor: "pointer",
            fontSize: 14,
            ...MONO,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export const CatchJournalPanel: React.FC = () => {
  const marker = useCatchJournalStore((s) => s.marker);
  const close = useCatchJournalStore((s) => s.close);
  const queryClient = useQueryClient();

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const markerId = marker?.id ?? "";
  const { data: catches, isLoading } = useGetMarkersMarkerIdCatches(markerId, {
    query: {
      enabled: !!markerId,
      queryKey: getGetMarkersMarkerIdCatchesQueryKey(markerId),
    },
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getGetMarkersMarkerIdCatchesQueryKey(markerId) });
    if (marker?.datasetId) {
      void queryClient.invalidateQueries({ queryKey: getGetCatchesQueryKey({ datasetId: marker.datasetId }) });
    }
  }, [queryClient, markerId, marker?.datasetId]);

  const createMutation = usePostMarkersMarkerIdCatches({
    mutation: { onSuccess: () => { invalidate(); setAdding(false); } },
  });
  const patchMutation = usePatchCatchesId({
    mutation: { onSuccess: () => { invalidate(); setEditingId(null); } },
  });
  const deleteMutation = useDeleteCatchesId({
    mutation: { onSuccess: () => { invalidate(); setConfirmDeleteId(null); } },
  });

  useEffect(() => {
    if (!marker) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (lightbox) setLightbox(null);
        else close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [marker, close, lightbox]);

  // Reset transient state when switching markers.
  useEffect(() => {
    setAdding(false);
    setEditingId(null);
    setLightbox(null);
    setConfirmDeleteId(null);
  }, [markerId]);

  if (!marker) return null;

  const entries = catches ?? [];

  return (
    <div
      data-testid="catch-journal-panel"
      style={{
        position: "absolute",
        top: 60,
        right: 16,
        width: 340,
        maxHeight: "calc(100vh - 120px)",
        overflowY: "auto",
        zIndex: 36,
        background: "rgba(0,10,20,0.95)",
        border: "1px solid rgba(0,229,255,0.3)",
        borderRadius: 4,
        padding: "10px 14px",
        color: "#cbd5e1",
        backdropFilter: "blur(8px)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
        ...MONO,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ color: "#22d3ee", fontSize: 17, fontWeight: 600 }}>
          🎣 Catch journal — {marker.label}
        </span>
        <button
          onClick={close}
          aria-label="Close catch journal"
          style={{
            background: "none",
            border: "1px solid rgba(0,229,255,0.2)",
            color: "#cbd5e1",
            padding: "0 6px",
            borderRadius: 2,
            cursor: "pointer",
            fontSize: 15,
            ...MONO,
          }}
        >
          ✕
        </button>
      </div>

      {!adding && (
        <button
          type="button"
          data-testid="catch-add-button"
          onClick={() => { setAdding(true); setEditingId(null); }}
          style={{
            width: "100%",
            background: "rgba(0,229,255,0.1)",
            border: "1px dashed rgba(0,229,255,0.4)",
            color: "#22d3ee",
            borderRadius: 3,
            padding: "7px 0",
            cursor: "pointer",
            fontSize: 14,
            marginBottom: 10,
            ...MONO,
          }}
        >
          + Log a catch
        </button>
      )}

      {adding && (
        <CatchEntryForm
          busy={createMutation.isPending}
          onSubmit={(data) => createMutation.mutate({ markerId, data })}
          onCancel={() => setAdding(false)}
        />
      )}

      {isLoading && <div style={{ color: "#94a3b8", fontSize: 13 }}>Loading…</div>}
      {!isLoading && entries.length === 0 && !adding && (
        <div data-testid="catch-empty" style={{ color: "#94a3b8", fontSize: 13, padding: "6px 0" }}>
          No catches logged at this spot yet.
        </div>
      )}

      {entries.map((entry) =>
        editingId === entry.id ? (
          <CatchEntryForm
            key={entry.id}
            initial={entry}
            busy={patchMutation.isPending}
            onSubmit={(data) => patchMutation.mutate({ id: entry.id, data })}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <div
            key={entry.id}
            data-testid={`catch-entry-${entry.id}`}
            style={{
              border: "1px solid rgba(0,229,255,0.15)",
              borderRadius: 4,
              padding: "8px 10px",
              marginBottom: 8,
              background: "rgba(0,229,255,0.02)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 20 }}>
                {entry.symbol}{" "}
                <span style={{ fontSize: 13, color: "#94a3b8" }}>
                  {entry.symbolName}
                </span>
              </span>
              <span style={{ fontSize: 11, color: "#64748b" }}>
                {new Date(entry.createdAt).toLocaleDateString()}
              </span>
            </div>
            {entry.notes && (
              <div style={{ fontSize: 13, color: "#cbd5e1", marginTop: 4, whiteSpace: "pre-wrap" }}>
                {entry.notes}
              </div>
            )}
            {entry.photos.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                {entry.photos.map((p) => (
                  <img
                    key={p}
                    src={photoSrc(p)}
                    alt="Catch photo"
                    onClick={() => setLightbox(p)}
                    style={{
                      width: 52,
                      height: 52,
                      objectFit: "cover",
                      borderRadius: 3,
                      border: "1px solid rgba(0,229,255,0.2)",
                      cursor: "zoom-in",
                    }}
                  />
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button
                type="button"
                data-testid={`catch-edit-${entry.id}`}
                onClick={() => { setEditingId(entry.id); setAdding(false); }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#22d3ee",
                  cursor: "pointer",
                  fontSize: 12,
                  padding: 0,
                  ...MONO,
                }}
              >
                ✏️ Edit
              </button>
              {confirmDeleteId === entry.id ? (
                <>
                  <button
                    type="button"
                    data-testid={`catch-delete-confirm-${entry.id}`}
                    onClick={() => deleteMutation.mutate({ id: entry.id })}
                    style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 12, padding: 0, ...MONO }}
                  >
                    Confirm delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 12, padding: 0, ...MONO }}
                  >
                    Keep
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  data-testid={`catch-delete-${entry.id}`}
                  onClick={() => setConfirmDeleteId(entry.id)}
                  style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 12, padding: 0, ...MONO }}
                >
                  🗑️ Delete
                </button>
              )}
            </div>
          </div>
        ),
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          data-testid="catch-lightbox"
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "zoom-out",
          }}
        >
          <img
            src={photoSrc(lightbox)}
            alt="Catch photo (full size)"
            style={{ maxWidth: "92vw", maxHeight: "92vh", borderRadius: 4 }}
          />
        </div>
      )}
    </div>
  );
};
