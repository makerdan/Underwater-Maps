/**
 * CollectionSettingsSheet — settings drawer for a "special" dataset collection
 * (puzzle assembly with a reference image).
 *
 * Exposes:
 *  (a) background image upload — drag-and-drop or file picker with a
 *      thumbnail preview (authed fetch/upload via the generated client);
 *  (b) opacity slider 10–90 % (default 50 %);
 *  (c) geo-anchor control — pin two control points (A and B) by clicking the
 *      preview image and typing the known lat/lon for each; the Overview
 *      overlay auto-scales/rotates the image to match;
 *  (d) layout revision list with Restore and Delete actions.
 *
 * Metadata changes are PATCHed to /user/collections/:id/meta and mirrored
 * into the specialCollectionStore so a live overlay updates immediately.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getUserCollectionsIdBackground,
  postUserCollectionsIdBackground,
  deleteUserCollectionsIdBackground,
  patchUserCollectionsIdMeta,
  deleteUserCollectionsIdLayoutRevisionId,
  getGetUserCollectionsQueryKey,
  type CollectionGeoAnchor,
  type DatasetCollection,
  type LayoutRevision,
} from "@workspace/api-client-react";
import { useSpecialCollectionStore } from "@/lib/specialCollectionStore";

const MONO = "'JetBrains Mono', 'Fira Code', monospace";
const REFERENCE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const REFERENCE_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const sectionTitleStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: "calc(11px * var(--bs-font-scale, 1))",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  margin: "14px 0 6px",
};

/** Pin marker rendered over the preview image for a placed anchor. */
const AnchorPin: React.FC<{ label: string; xPct: number; yPct: number; color: string }> = ({
  label,
  xPct,
  yPct,
  color,
}) => (
  <div
    style={{
      position: "absolute",
      left: `${xPct}%`,
      top: `${yPct}%`,
      transform: "translate(-50%, -100%)",
      color,
      fontSize: "calc(12px * var(--bs-font-scale, 1))",
      fontWeight: 700,
      textShadow: "0 0 3px rgba(0,0,0,0.9)",
      pointerEvents: "none",
      lineHeight: 1,
    }}
  >
    📍{label}
  </div>
);

interface AnchorDraft {
  imgX: number | null;
  imgY: number | null;
  lon: string;
  lat: string;
}

const EMPTY_DRAFT: AnchorDraft = { imgX: null, imgY: null, lon: "", lat: "" };
const ANCHOR_EPSILON = 1e-9;

interface AnchorValidation {
  anchor: CollectionGeoAnchor | null;
  imageMessage: string;
  longitudeMessage: string | null;
  latitudeMessage: string | null;
}

function coordinateMessage(
  raw: string,
  label: "Longitude" | "Latitude",
  min: number,
  max: number,
): { value: number | null; message: string | null } {
  if (!raw.trim()) return { value: null, message: `${label} is required.` };
  const value = Number(raw);
  if (!Number.isFinite(value)) return { value: null, message: `${label} must be a number.` };
  if (value < min || value > max) {
    return { value: null, message: `${label} must be between ${min} and ${max}.` };
  }
  return { value, message: null };
}

function validateAnchorDraft(draft: AnchorDraft): AnchorValidation {
  const longitude = coordinateMessage(draft.lon, "Longitude", -180, 180);
  const latitude = coordinateMessage(draft.lat, "Latitude", -90, 90);
  const imagePointValid =
    Number.isFinite(draft.imgX) &&
    Number.isFinite(draft.imgY) &&
    (draft.imgX ?? -1) >= 0 &&
    (draft.imgY ?? -1) >= 0;
  const imageMessage = imagePointValid
    ? `Image point set: (${draft.imgX}, ${draft.imgY}).`
    : "Image point missing — choose Pin point and click the image.";
  const anchor =
    imagePointValid && longitude.value !== null && latitude.value !== null
      ? { lon: longitude.value, lat: latitude.value, imgX: draft.imgX!, imgY: draft.imgY! }
      : null;
  return {
    anchor,
    imageMessage,
    longitudeMessage: longitude.message,
    latitudeMessage: latitude.message,
  };
}

function wrappedLongitudeDifference(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function anchorPairMessage(
  anchorA: CollectionGeoAnchor | null,
  anchorB: CollectionGeoAnchor | null,
): string | null {
  if (!anchorA || !anchorB) return "Complete both image points and their GPS coordinates to save.";
  if (
    Math.hypot(anchorA.imgX - anchorB.imgX, anchorA.imgY - anchorB.imgY) <= ANCHOR_EPSILON
  ) {
    return "Image points A and B must be different.";
  }
  if (
    wrappedLongitudeDifference(anchorA.lon, anchorB.lon) <= ANCHOR_EPSILON &&
    Math.abs(anchorA.lat - anchorB.lat) <= ANCHOR_EPSILON
  ) {
    return "GPS coordinates A and B must be different.";
  }
  return null;
}

export const CollectionSettingsSheet: React.FC<{
  collection: DatasetCollection;
  onClose: () => void;
  returnFocusTarget?: HTMLElement | null;
}> = ({ collection, onClose, returnFocusTarget = null }) => {
  const qc = useQueryClient();
  const meta = collection.specialMeta;
  // ---- Background image preview -----------------------------------------
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removingImage, setRemovingImage] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultMemberId, setDefaultMemberId] = useState<string | null>(
    collection.defaultMemberId,
  );
  const [defaultSaveState, setDefaultSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  useEffect(() => {
    setDefaultMemberId(collection.defaultMemberId);
    setDefaultSaveState("idle");
  }, [collection.id, collection.defaultMemberId]);

  const handleDefaultMemberChange = useCallback(
    async (memberId: string) => {
      if (defaultSaveState === "saving") return;
      const nextDefault = memberId || null;
      setDefaultMemberId(nextDefault);
      setDefaultSaveState("saving");
      setError(null);
      try {
        const updated = await patchUserCollectionsIdMeta(collection.id, {
          defaultMemberId: nextDefault,
        });
        setDefaultMemberId(updated.defaultMemberId);
        qc.setQueryData<DatasetCollection[]>(
          getGetUserCollectionsQueryKey(),
          (previous) => previous?.map((item) => (item.id === updated.id ? updated : item)),
        );
        await qc.invalidateQueries({ queryKey: getGetUserCollectionsQueryKey() });
        setDefaultSaveState("saved");
      } catch {
        setDefaultMemberId(collection.defaultMemberId);
        setDefaultSaveState("error");
        setError("Could not save the default dataset. Please try again.");
      }
    },
    [collection.defaultMemberId, collection.id, defaultSaveState, qc],
  );
  const [imageLoadState, setImageLoadState] = useState<"none" | "loading" | "loaded" | "error">(
    () => meta?.bgImageKey ? "loading" : "none",
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const setPreviewFromBlob = useCallback((blob: Blob | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    if (blob && blob.size > 0) {
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setPreviewUrl(url);
    } else {
      previewUrlRef.current = null;
      setPreviewUrl(null);
      setImgNatural(null);
    }
  }, []);

  useEffect(() => {
    openerRef.current =
      returnFocusTarget ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const panel = panelRef.current;
    panel?.focus();
    return () => {
      const target =
        openerRef.current && document.contains(openerRef.current)
          ? openerRef.current
          : panel && document.contains(panel)
            ? panel
            : null;
      target?.focus();
    };
  }, [returnFocusTarget]);

  // Load the existing background image once (authed endpoint — cannot use a
  // bare <img src> URL because the Authorization header would be missing).
  useEffect(() => {
    let cancelled = false;
    if (meta?.bgImageKey) {
      setImageLoadState("loading");
      getUserCollectionsIdBackground(collection.id)
        .then((blob) => {
          if (cancelled) return;
          if (blob instanceof Blob && blob.size > 0) {
            setPreviewFromBlob(blob);
            setImageLoadState("loaded");
            return;
          }
          setImageLoadState("error");
        })
        .catch(() => {
          if (!cancelled) setImageLoadState("error");
        });
    }
    return () => {
      cancelled = true;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run only on mount/collection change; meta.bgImageKey updates are handled by the upload/remove handlers themselves
  }, [collection.id]);

  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: getGetUserCollectionsQueryKey() }),
    [qc],
  );

  const handleUpload = useCallback(
    async (file: File) => {
      if (uploading) return;
      setError(null);
      if (!REFERENCE_IMAGE_MIME_TYPES.has(file.type)) {
        setError("Reference images must be JPEG, PNG, or WebP files.");
        return;
      }
      if (file.size > REFERENCE_IMAGE_MAX_BYTES) {
        setError("Reference images must be 10 MB or smaller.");
        return;
      }
      setUploading(true);
      try {
        await postUserCollectionsIdBackground(collection.id, { file });
        setPreviewFromBlob(file);
        setImageLoadState("loaded");
        await useSpecialCollectionStore.getState().reloadBgImage(collection.id);
        await invalidate();
      } catch {
        setError("Upload failed. Please try again.");
      } finally {
        setUploading(false);
      }
    },
    [collection.id, uploading, invalidate, setPreviewFromBlob],
  );

  const handleRemoveImage = useCallback(async () => {
    if (removingImage) return;
    setRemovingImage(true);
    setError(null);
    try {
      await deleteUserCollectionsIdBackground(collection.id);
      setPreviewFromBlob(null);
      setImageLoadState("none");
      await useSpecialCollectionStore.getState().reloadBgImage(collection.id);
      await invalidate();
    } catch {
      setError("Could not remove the image.");
    } finally {
      setRemovingImage(false);
    }
  }, [collection.id, invalidate, removingImage, setPreviewFromBlob]);

  // ---- Opacity slider (10–90 %, default 50 %) ----------------------------
  const [opacityPct, setOpacityPct] = useState(() =>
    Math.round(Math.min(0.9, Math.max(0.1, meta?.bgOpacity ?? 0.5)) * 100),
  );
  const opacityPatchTimer = useRef<number | null>(null);
  const pendingOpacityRef = useRef<number | null>(null);
  const opacitySaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const flushOpacityRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const [opacitySaveState, setOpacitySaveState] = useState<"idle" | "saving" | "saved" | "unsynced">("idle");

  const savePendingOpacity = useCallback(async () => {
    while (pendingOpacityRef.current !== null) {
      const pct = pendingOpacityRef.current;
      pendingOpacityRef.current = null;
      setOpacitySaveState("saving");
      try {
        const updated = await patchUserCollectionsIdMeta(collection.id, { bgOpacity: pct / 100 });
        qc.setQueryData<DatasetCollection[]>(getGetUserCollectionsQueryKey(), (previous) =>
          previous?.map((item) => (item.id === updated.id ? updated : item)),
        );
        await invalidate();
      } catch {
        // Keep the latest choice queued for the explicit retry button. If a
        // newer slider value arrived while this request was in flight, preserve
        // that newer value instead of putting the stale request back.
        if (pendingOpacityRef.current === null) pendingOpacityRef.current = pct;
        setOpacitySaveState("unsynced");
        setError("Opacity is not saved yet. Retry to keep this setting across devices.");
        return;
      }
    }
    setOpacitySaveState("saved");
  }, [collection.id, invalidate, qc]);

  const flushOpacity = useCallback(() => {
    const run = opacitySaveChainRef.current.then(() => savePendingOpacity());
    // A rejected call is represented in UI state; keep the serialization chain
    // alive so a later retry cannot jump ahead of an older in-flight request.
    opacitySaveChainRef.current = run.catch(() => undefined);
    return run;
  }, [savePendingOpacity]);

  flushOpacityRef.current = flushOpacity;

  const handleOpacityChange = useCallback(
    (pct: number) => {
      setOpacityPct(pct);
      // Live-sync the overlay; debounce the PATCH.
      useSpecialCollectionStore.getState().setBgOpacity(collection.id, pct / 100);
      if (opacityPatchTimer.current !== null) window.clearTimeout(opacityPatchTimer.current);
      pendingOpacityRef.current = pct;
      setOpacitySaveState("idle");
      setError(null);
      opacityPatchTimer.current = window.setTimeout(() => {
        opacityPatchTimer.current = null;
        void flushOpacity();
      }, 400);
    },
    [collection.id, flushOpacity],
  );
  useEffect(
    () => () => {
      if (opacityPatchTimer.current !== null) window.clearTimeout(opacityPatchTimer.current);
      // Closing the sheet must never discard a debounced last slider value.
      void flushOpacityRef.current();
    },
    [],
  );

  // ---- Geo anchors --------------------------------------------------------
  const existingAnchors = (meta?.bgGeoAnchors ?? null) as CollectionGeoAnchor[] | null;
  const [anchorMode, setAnchorMode] = useState<"A" | "B" | null>(null);
  const [draftA, setDraftA] = useState<AnchorDraft>(() =>
    existingAnchors?.[0]
      ? {
          imgX: existingAnchors[0].imgX,
          imgY: existingAnchors[0].imgY,
          lon: String(existingAnchors[0].lon),
          lat: String(existingAnchors[0].lat),
        }
      : EMPTY_DRAFT,
  );
  const [draftB, setDraftB] = useState<AnchorDraft>(() =>
    existingAnchors?.[1]
      ? {
          imgX: existingAnchors[1].imgX,
          imgY: existingAnchors[1].imgY,
          lon: String(existingAnchors[1].lon),
          lat: String(existingAnchors[1].lat),
        }
      : EMPTY_DRAFT,
  );
  const [anchorsSaving, setAnchorsSaving] = useState(false);
  const [anchorsClearing, setAnchorsClearing] = useState(false);
  const [anchorSaveStatus, setAnchorSaveStatus] = useState<string | null>(null);
  const [hasSavedAnchors, setHasSavedAnchors] = useState(() => existingAnchors !== null);

  const handlePreviewClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!anchorMode || !imgNatural) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;
      const imgX = Math.max(0, Math.round(relX * imgNatural.w));
      const imgY = Math.max(0, Math.round(relY * imgNatural.h));
      if (anchorMode === "A") setDraftA((d) => ({ ...d, imgX, imgY }));
      else setDraftB((d) => ({ ...d, imgX, imgY }));
      setAnchorSaveStatus(null);
      setError(null);
      setAnchorMode(null);
    },
    [anchorMode, imgNatural],
  );

  const validationA = validateAnchorDraft(draftA);
  const validationB = validateAnchorDraft(draftB);
  const anchorA = validationA.anchor;
  const anchorB = validationB.anchor;
  const pairMessage = anchorPairMessage(anchorA, anchorB);
  const anchorsComplete = pairMessage === null;

  const handleSaveAnchors = useCallback(async () => {
    if (!anchorA || !anchorB || pairMessage || anchorsSaving) return;
    setAnchorsSaving(true);
    setError(null);
    setAnchorSaveStatus(null);
    try {
      const updated = await patchUserCollectionsIdMeta(collection.id, {
        bgGeoAnchors: [anchorA, anchorB],
      });
      const savedAnchors = updated.specialMeta?.bgGeoAnchors;
      if (!savedAnchors || savedAnchors.length !== 2) {
        throw new Error("The server did not confirm both saved anchors.");
      }
      useSpecialCollectionStore.getState().setBgAnchors(collection.id, savedAnchors);
      qc.setQueryData<DatasetCollection[]>(getGetUserCollectionsQueryKey(), (previous) =>
        previous?.map((item) => (item.id === updated.id ? updated : item)),
      );
      setHasSavedAnchors(true);
      setAnchorSaveStatus("Anchors saved. The live reference image is now GPS-registered.");
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? `Could not save anchors: ${err.message}. Your points are still here; correct them or retry.`
          : "Could not save anchors. Your points are still here; correct them or retry.",
      );
    } finally {
      setAnchorsSaving(false);
    }
  }, [anchorA, anchorB, anchorsSaving, collection.id, pairMessage, qc]);

  const handleClearAnchors = useCallback(async () => {
    if (anchorsClearing) return;
    setAnchorsClearing(true);
    setError(null);
    try {
      const updated = await patchUserCollectionsIdMeta(collection.id, { bgGeoAnchors: null });
      useSpecialCollectionStore.getState().setBgAnchors(collection.id, null);
      qc.setQueryData<DatasetCollection[]>(getGetUserCollectionsQueryKey(), (previous) =>
        previous?.map((item) => (item.id === updated.id ? updated : item)),
      );
      setDraftA(EMPTY_DRAFT);
      setDraftB(EMPTY_DRAFT);
      setHasSavedAnchors(false);
      setAnchorSaveStatus("Anchors cleared. The image will use dataset bounds until new anchors are saved.");
    } catch {
      setError("Could not clear the geo anchors.");
    } finally {
      setAnchorsClearing(false);
    }
  }, [anchorsClearing, collection.id, qc]);

  // ---- Revision list ------------------------------------------------------
  const [removedRevisionIds, setRemovedRevisionIds] = useState<Set<string>>(() => new Set());
  const revisions = [...(meta?.layoutRevisions ?? [])]
    .filter((revision) => !removedRevisionIds.has(revision.id))
    .sort((a, b) =>
    a.savedAt < b.savedAt ? 1 : -1,
  );
  const [deletingRevisionIds, setDeletingRevisionIds] = useState<Set<string>>(() => new Set());
  const [confirmDeleteRevision, setConfirmDeleteRevision] = useState<LayoutRevision | null>(null);
  const [revisionDeleteError, setRevisionDeleteError] = useState<string | null>(null);
  const [restoringRevisionId, setRestoringRevisionId] = useState<string | null>(null);
  const [activeRevisionId, setActiveRevisionId] = useState(meta?.activeRevisionId ?? null);
  const [revisionStatus, setRevisionStatus] = useState<string | null>(null);
  const revisionDeleteOpenerRef = useRef<HTMLElement | null>(null);
  const revisionDeleteInFlightRef = useRef<Set<string>>(new Set());

  const handleRestoreRevision = useCallback(
    async (rev: LayoutRevision) => {
      if (restoringRevisionId) return;
      const store = useSpecialCollectionStore.getState();
      // Restoring from the sheet only makes sense when this collection is the
      // active one; the "Activate for Puzzle" flow covers the cold path.
      if (store.active?.collectionId !== collection.id) return;
      setRestoringRevisionId(rev.id);
      setRevisionStatus(null);
      setError(null);
      store.requestRestore({
        tiles: rev.tiles.map((tl) => ({
          datasetId: tl.datasetId,
          tx: tl.tx,
          ty: tl.ty,
          angleDeg: tl.angleDeg,
          locked: tl.locked,
          annotation: tl.annotation ?? undefined,
        })),
        groups: rev.groups.map((g) => [...g.datasetIds]),
      });
      try {
        const updated = await patchUserCollectionsIdMeta(collection.id, { activeRevisionId: rev.id });
        if (updated.specialMeta?.activeRevisionId !== rev.id) {
          throw new Error("The server did not confirm this revision as active.");
        }
        qc.setQueryData<DatasetCollection[]>(getGetUserCollectionsQueryKey(), (previous) =>
          previous?.map((item) => (item.id === updated.id ? updated : item)),
        );
        useSpecialCollectionStore.getState().setRevisions(
          collection.id,
          updated.specialMeta.layoutRevisions,
          updated.specialMeta.activeRevisionId,
        );
        setActiveRevisionId(rev.id);
        setRevisionStatus(`"${rev.name}" restored and saved as the active layout.`);
      } catch (err) {
        setRevisionStatus(`"${rev.name}" was restored locally but is not saved as active.`);
        setError(
          err instanceof Error && err.message
            ? `Could not save the active layout: ${err.message}`
            : "Could not save the active layout. Retry Restore to save it.",
        );
      } finally {
        setRestoringRevisionId(null);
      }
    },
    [collection.id, qc, restoringRevisionId],
  );

  const handleConfirmDeleteRevision = useCallback(
    async () => {
      const rev = confirmDeleteRevision;
      if (!rev || revisionDeleteInFlightRef.current.has(rev.id)) return;
      revisionDeleteInFlightRef.current.add(rev.id);
      setDeletingRevisionIds((s) => new Set(s).add(rev.id));
      setRevisionDeleteError(null);
      setError(null);
      try {
        await deleteUserCollectionsIdLayoutRevisionId(collection.id, rev.id);
        const remaining = (meta?.layoutRevisions ?? []).filter((item) => item.id !== rev.id);
        const nextActiveRevisionId =
          activeRevisionId === rev.id ? remaining[remaining.length - 1]?.id ?? null : activeRevisionId;
        setRemovedRevisionIds((s) => new Set(s).add(rev.id));
        setActiveRevisionId(nextActiveRevisionId);
        useSpecialCollectionStore.getState().setRevisions(
          collection.id,
          remaining,
          nextActiveRevisionId,
        );
        setConfirmDeleteRevision(null);
        await invalidate();
      } catch {
        setRevisionDeleteError(
          "Could not delete the revision. It is still saved; check your connection and retry.",
        );
      } finally {
        revisionDeleteInFlightRef.current.delete(rev.id);
        setDeletingRevisionIds((s) => {
          const n = new Set(s);
          n.delete(rev.id);
          return n;
        });
      }
    },
    [activeRevisionId, collection.id, confirmDeleteRevision, invalidate, meta?.layoutRevisions],
  );

  useEffect(() => {
    if (!confirmDeleteRevision) return;
    const opener = revisionDeleteOpenerRef.current;
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [confirmDeleteRevision]);

  const isActiveCollection =
    useSpecialCollectionStore((s) => s.active?.collectionId) === collection.id;
  const isBusy =
    defaultSaveState === "saving" ||
    uploading ||
    removingImage ||
    anchorsSaving ||
    anchorsClearing ||
    opacitySaveState === "saving" ||
    restoringRevisionId !== null ||
    deletingRevisionIds.size > 0;
  const requestClose = useCallback(async () => {
    if (isBusy) return;
    if (opacityPatchTimer.current !== null) {
      window.clearTimeout(opacityPatchTimer.current);
      opacityPatchTimer.current = null;
    }
    // Do not close over a local-only slider choice. A failed final flush leaves
    // this sheet open with retryable "unsynced" feedback instead of claiming
    // that the settings are durable.
    await flushOpacity();
    if (pendingOpacityRef.current !== null) return;
    onClose();
  }, [flushOpacity, isBusy, onClose]);

  const anchorFieldStyle: React.CSSProperties = {
    width: 82,
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(0,229,255,0.2)",
    borderRadius: 3,
    color: "#e2e8f0",
    padding: "2px 6px",
    fontSize: "calc(12px * var(--bs-font-scale, 1))",
    outline: "none",
    fontFamily: "inherit",
  };

  const renderAnchorRow = (
    label: "A" | "B",
    draft: AnchorDraft,
    validation: AnchorValidation,
    setDraft: React.Dispatch<React.SetStateAction<AnchorDraft>>,
  ) => (
    <div
      data-testid={`anchor-row-${label.toLowerCase()}-${collection.id}`}
      style={{ marginBottom: 8, padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
    >
      <div className="flex items-center gap-1" style={{ flexWrap: "wrap" }}>
      <button
        data-testid={`btn-pin-anchor-${label.toLowerCase()}-${collection.id}`}
        onClick={() => setAnchorMode((m) => (m === label ? null : label))}
        disabled={!previewUrl}
        aria-pressed={anchorMode === label}
        style={{
          background: anchorMode === label ? "rgba(0,229,255,0.15)" : "transparent",
          border: `1px solid ${anchorMode === label ? "rgba(0,229,255,0.6)" : "rgba(0,229,255,0.25)"}`,
          borderRadius: 3,
          color: previewUrl ? "#00e5ff" : "#475569",
          fontSize: "calc(11px * var(--bs-font-scale, 1))",
          padding: "2px 8px",
          cursor: previewUrl ? "pointer" : "not-allowed",
          letterSpacing: "0.05em",
          whiteSpace: "nowrap",
        }}
      >
        {anchorMode === label ? `Click image…` : `Pin point ${label}`}
      </button>
      <span style={{ color: "#64748b", fontSize: "calc(11px * var(--bs-font-scale, 1))" }}>
        {draft.imgX !== null && draft.imgY !== null ? `(${draft.imgX}, ${draft.imgY})` : "not set"}
      </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 6,
          marginTop: 5,
        }}
      >
        <label style={{ color: "#94a3b8", fontSize: "calc(11px * var(--bs-font-scale, 1))" }}>
          Longitude (°)
          <input
            data-testid={`input-anchor-${label.toLowerCase()}-lon-${collection.id}`}
            aria-label={`Anchor ${label} longitude`}
            type="number"
            inputMode="decimal"
            min={-180}
            max={180}
            step="any"
            placeholder="-180 to 180"
            value={draft.lon}
            onChange={(e) => {
              setDraft((d) => ({ ...d, lon: e.target.value }));
              setAnchorSaveStatus(null);
              setError(null);
            }}
            style={{ ...anchorFieldStyle, width: "100%", display: "block", marginTop: 2 }}
          />
        </label>
        <label style={{ color: "#94a3b8", fontSize: "calc(11px * var(--bs-font-scale, 1))" }}>
          Latitude (°)
          <input
            data-testid={`input-anchor-${label.toLowerCase()}-lat-${collection.id}`}
            aria-label={`Anchor ${label} latitude`}
            type="number"
            inputMode="decimal"
            min={-90}
            max={90}
            step="any"
            placeholder="-90 to 90"
            value={draft.lat}
            onChange={(e) => {
              setDraft((d) => ({ ...d, lat: e.target.value }));
              setAnchorSaveStatus(null);
              setError(null);
            }}
            style={{ ...anchorFieldStyle, width: "100%", display: "block", marginTop: 2 }}
          />
        </label>
      </div>
      <div
        role="status"
        data-testid={`anchor-status-${label.toLowerCase()}-${collection.id}`}
        style={{ marginTop: 4, color: validation.anchor ? "#86efac" : "#fbbf24", fontSize: "calc(10.5px * var(--bs-font-scale, 1))", lineHeight: 1.35 }}
      >
        {validation.imageMessage}
        {validation.longitudeMessage ? ` ${validation.longitudeMessage}` : ""}
        {validation.latitudeMessage ? ` ${validation.latitudeMessage}` : ""}
        {validation.anchor ? " GPS coordinates valid." : ""}
      </div>
    </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Settings for collection "${collection.name}"`}
      data-testid={`collection-settings-sheet-${collection.id}`}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
      }}
      onClick={() => void requestClose()}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        if (confirmDeleteRevision && !deletingRevisionIds.has(confirmDeleteRevision.id)) {
          setConfirmDeleteRevision(null);
          return;
        }
        void requestClose();
      }}
      tabIndex={-1}
      aria-busy={isBusy || undefined}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "rgba(0,10,20,0.97)",
          border: "1px solid rgba(0,229,255,0.35)",
          borderRadius: 6,
          padding: 18,
          width: 420,
          maxWidth: "92vw",
          maxHeight: "86vh",
          overflowY: "auto",
          color: "#cbd5e1",
          fontFamily: MONO,
          fontSize: "calc(13px * var(--bs-font-scale, 1))",
        }}
      >
        <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
          <div
            style={{
              fontSize: "calc(15px * var(--bs-font-scale, 1))",
              fontWeight: 700,
              letterSpacing: "0.05em",
            }}
          >
            ✷ {collection.name} — settings
          </div>
          <button
            data-testid={`btn-close-collection-settings-${collection.id}`}
            onClick={() => void requestClose()}
            aria-label="Close settings"
            disabled={isBusy}
            style={{
              background: "transparent",
              border: "none",
              color: "#64748b",
              cursor: "pointer",
              fontSize: "calc(14px * var(--bs-font-scale, 1))",
              padding: "2px 6px",
            }}
          >
            ✕
          </button>
        </div>

        {error && (
          <div
            data-testid="collection-settings-error"
            style={{ color: "#fca5a5", fontSize: "calc(12px * var(--bs-font-scale, 1))", margin: "4px 0" }}
          >
            {error}
          </div>
        )}

        <div style={sectionTitleStyle}>Default dataset</div>
        <select
          data-testid={`select-collection-default-${collection.id}`}
          aria-label="Default dataset"
          value={defaultMemberId ?? ""}
          onChange={(e) => void handleDefaultMemberChange(e.target.value)}
          disabled={defaultSaveState === "saving"}
          style={{
            width: "100%",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(0,229,255,0.25)",
            borderRadius: 3,
            color: "#e2e8f0",
            padding: "5px 7px",
            fontFamily: "inherit",
            fontSize: "calc(12px * var(--bs-font-scale, 1))",
          }}
        >
          <option value="">Automatic — first available</option>
          {collection.members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name} ({member.kind === "dataset" ? "Uploaded" : "Catalog save"})
            </option>
          ))}
        </select>
        <div
          data-testid={`collection-default-save-status-${collection.id}`}
          role="status"
          style={{
            minHeight: 16,
            marginTop: 3,
            color:
              defaultSaveState === "error"
                ? "#fca5a5"
                : defaultSaveState === "saved"
                  ? "#86efac"
                  : "#94a3b8",
            fontSize: "calc(11px * var(--bs-font-scale, 1))",
          }}
        >
          {defaultSaveState === "saving"
            ? "Saving default dataset…"
            : defaultSaveState === "saved"
              ? "Default dataset saved."
              : defaultSaveState === "error"
                ? "Default dataset was not saved."
                : ""}
        </div>

        {collection.collectionKind === "special" && (
        <>
        {/* (a) Background image upload */}
        <div style={sectionTitleStyle}>Reference image</div>
        <div
          data-testid={`collection-bg-dropzone-${collection.id}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void handleUpload(file);
          }}
          onClick={anchorMode ? undefined : () => fileInputRef.current?.click()}
          style={{
            position: "relative",
            border: `1px dashed ${dragOver ? "rgba(0,229,255,0.8)" : "rgba(0,229,255,0.3)"}`,
            borderRadius: 4,
            minHeight: 90,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: anchorMode ? "crosshair" : "pointer",
            background: dragOver ? "rgba(0,229,255,0.06)" : "rgba(255,255,255,0.02)",
            overflow: "hidden",
          }}
        >
          {previewUrl ? (
            <div
              style={{ position: "relative", width: "100%" }}
              onClick={(e) => {
                if (anchorMode) {
                  e.stopPropagation();
                  handlePreviewClick(e);
                }
              }}
            >
              <img
                data-testid={`collection-bg-preview-${collection.id}`}
                src={previewUrl}
                alt="Reference background"
                style={{ display: "block", width: "100%", height: "auto" }}
                onError={() => {
                  setPreviewFromBlob(null);
                  setImageLoadState("error");
                }}
                onLoad={(e) =>
                  setImgNatural({
                    w: e.currentTarget.naturalWidth,
                    h: e.currentTarget.naturalHeight,
                  })
                }
              />
              {imgNatural && draftA.imgX !== null && draftA.imgY !== null && (
                <AnchorPin
                  label="A"
                  xPct={(draftA.imgX / imgNatural.w) * 100}
                  yPct={(draftA.imgY / imgNatural.h) * 100}
                  color="#4ade80"
                />
              )}
              {imgNatural && draftB.imgX !== null && draftB.imgY !== null && (
                <AnchorPin
                  label="B"
                  xPct={(draftB.imgX / imgNatural.w) * 100}
                  yPct={(draftB.imgY / imgNatural.h) * 100}
                  color="#fbbf24"
                />
              )}
            </div>
          ) : (
            <span style={{ color: "#64748b", fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: 12, textAlign: "center" }}>
              {uploading
                ? "Uploading…"
                : imageLoadState === "loading"
                  ? "Loading configured reference image…"
                  : imageLoadState === "error"
                    ? "Configured reference image could not be loaded."
                    : "Drag an image here, or click to choose a file"}
            </span>
          )}
        </div>
        {imageLoadState === "error" && (
          <div
            data-testid={`collection-bg-load-error-${collection.id}`}
            role="alert"
            style={{ marginTop: 4, color: "#fbbf24", fontSize: "calc(11.5px * var(--bs-font-scale, 1))", lineHeight: 1.35 }}
          >
            This collection has a configured reference image, but it is unavailable. Replace it or remove it to recover.
          </div>
        )}
        <input
          ref={fileInputRef}
          data-testid={`input-collection-bg-file-${collection.id}`}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleUpload(file);
            e.target.value = "";
          }}
        />
        {previewUrl && (
          <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
            <button
              data-testid={`btn-replace-collection-bg-${collection.id}`}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || removingImage}
              style={{
                background: "transparent",
                border: "1px solid rgba(0,229,255,0.25)",
                borderRadius: 3,
                color: "#00e5ff",
                fontSize: "calc(11px * var(--bs-font-scale, 1))",
                padding: "2px 8px",
                cursor: "pointer",
              }}
            >
              {uploading ? "Uploading…" : removingImage ? "Removing…" : "Replace"}
            </button>
            <button
              data-testid={`btn-remove-collection-bg-${collection.id}`}
              onClick={() => void handleRemoveImage()}
              disabled={uploading || removingImage}
              style={{
                background: "transparent",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 3,
                color: "#f87171",
                fontSize: "calc(11px * var(--bs-font-scale, 1))",
                padding: "2px 8px",
                cursor: "pointer",
              }}
            >
              {removingImage ? "Removing…" : "Remove"}
            </button>
          </div>
        )}

        {/* (b) Opacity slider */}
        <div style={sectionTitleStyle}>Overlay opacity — {opacityPct}%</div>
        <input
          data-testid={`input-collection-bg-opacity-${collection.id}`}
          type="range"
          min={10}
          max={90}
          step={1}
          value={opacityPct}
          onChange={(e) => handleOpacityChange(Number(e.target.value))}
          style={{ width: "100%" }}
          aria-label="Background image opacity"
        />
        {opacitySaveState !== "idle" && (
          <div
            data-testid={`collection-opacity-save-status-${collection.id}`}
            role="status"
            style={{ marginTop: 3, color: opacitySaveState === "unsynced" ? "#fbbf24" : opacitySaveState === "saved" ? "#86efac" : "#94a3b8", fontSize: "calc(11px * var(--bs-font-scale, 1))" }}
          >
            {opacitySaveState === "saving"
              ? "Saving opacity…"
              : opacitySaveState === "saved"
                ? "Opacity saved."
                : "Opacity is not saved yet."}
            {opacitySaveState === "unsynced" && (
              <button
                data-testid={`btn-retry-collection-bg-opacity-${collection.id}`}
                onClick={() => void flushOpacity()}
                style={{ marginLeft: 7, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: 3, color: "#fbbf24", cursor: "pointer", fontSize: "calc(10.5px * var(--bs-font-scale, 1))", padding: "1px 6px" }}
              >
                Retry
              </button>
            )}
          </div>
        )}

        {/* (c) Geo anchors */}
        <div style={sectionTitleStyle}>Geo anchors</div>
        <div style={{ color: "#64748b", fontSize: "calc(11.5px * var(--bs-font-scale, 1))", marginBottom: 6 }}>
          Pin two known points on the image, then enter each point’s longitude
          followed by latitude. The
          overlay scales and rotates to match. Without anchors the image is
          stretched over the loaded datasets.
        </div>
        {renderAnchorRow("A", draftA, validationA, setDraftA)}
        {renderAnchorRow("B", draftB, validationB, setDraftB)}
        {pairMessage && (
          <div
            data-testid={`anchor-pair-status-${collection.id}`}
            role="status"
            style={{ color: "#fbbf24", fontSize: "calc(11px * var(--bs-font-scale, 1))", marginTop: 2 }}
          >
            {pairMessage}
          </div>
        )}
        {anchorSaveStatus && (
          <div
            data-testid={`anchor-save-status-${collection.id}`}
            role="status"
            style={{ color: "#86efac", fontSize: "calc(11px * var(--bs-font-scale, 1))", marginTop: 2 }}
          >
            {anchorSaveStatus}
          </div>
        )}
        <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
          <button
            data-testid={`btn-save-anchors-${collection.id}`}
            onClick={() => void handleSaveAnchors()}
            disabled={!anchorsComplete || anchorsSaving}
            style={{
              background: anchorsComplete ? "rgba(0,229,255,0.1)" : "transparent",
              border: "1px solid rgba(0,229,255,0.3)",
              borderRadius: 3,
              color: anchorsComplete ? "#00e5ff" : "#475569",
              fontSize: "calc(11px * var(--bs-font-scale, 1))",
              padding: "2px 10px",
              cursor: anchorsComplete && !anchorsSaving ? "pointer" : "not-allowed",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {anchorsSaving ? "Saving…" : "Save anchors"}
          </button>
          {hasSavedAnchors && (
            <button
              data-testid={`btn-clear-anchors-${collection.id}`}
              onClick={() => void handleClearAnchors()}
              disabled={anchorsClearing}
              style={{
                background: "transparent",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 3,
                color: "#f87171",
                fontSize: "calc(11px * var(--bs-font-scale, 1))",
                padding: "2px 10px",
                cursor: "pointer",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {anchorsClearing ? "Clearing…" : "Clear"}
            </button>
          )}
        </div>

        {/* (d) Layout revisions */}
        <div style={sectionTitleStyle}>Layout revisions</div>
        {revisionStatus && (
          <div
            data-testid={`collection-revision-status-${collection.id}`}
            role="status"
            style={{ color: revisionStatus.includes("not saved") ? "#fbbf24" : "#86efac", fontSize: "calc(11px * var(--bs-font-scale, 1))", marginBottom: 4 }}
          >
            {revisionStatus}
          </div>
        )}
        {revisions.length === 0 ? (
          <div
            data-testid={`collection-revisions-empty-${collection.id}`}
            style={{ color: "#64748b", fontSize: "calc(12px * var(--bs-font-scale, 1))" }}
          >
            No saved layouts yet — arrange tiles in the Overview puzzle and use
            “Save Layout…”.
          </div>
        ) : (
          revisions.map((rev) => (
            <div
              key={rev.id}
              data-testid={`collection-revision-row-${rev.id}`}
              className="flex items-center gap-2"
              style={{
                padding: "3px 4px",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                {rev.name}
                {activeRevisionId === rev.id && (
                  <span style={{ color: "#fbbf24", marginLeft: 6, fontSize: "calc(10px * var(--bs-font-scale, 1))" }}>
                    ACTIVE
                  </span>
                )}
                <span style={{ color: "#64748b", marginLeft: 6, fontSize: "calc(10.5px * var(--bs-font-scale, 1))" }}>
                  {new Date(rev.savedAt).toLocaleString()}
                </span>
              </span>
              <button
                data-testid={`btn-restore-revision-${rev.id}`}
                onClick={() => void handleRestoreRevision(rev)}
                disabled={!isActiveCollection || restoringRevisionId !== null}
                title={
                  isActiveCollection
                    ? `Restore "${rev.name}"`
                    : "Activate this collection for puzzle first"
                }
                style={{
                  background: "transparent",
                  border: "1px solid rgba(0,229,255,0.25)",
                  borderRadius: 3,
                  color: isActiveCollection ? "#00e5ff" : "#475569",
                  fontSize: "calc(11px * var(--bs-font-scale, 1))",
                  padding: "1px 8px",
                  cursor: isActiveCollection ? "pointer" : "not-allowed",
                }}
              >
                {restoringRevisionId === rev.id ? "Restoring…" : "Restore"}
              </button>
              <button
                data-testid={`btn-delete-revision-${rev.id}`}
                onClick={() => {
                  revisionDeleteOpenerRef.current =
                    document.activeElement instanceof HTMLElement ? document.activeElement : null;
                  setRevisionDeleteError(null);
                  setConfirmDeleteRevision(rev);
                }}
                disabled={deletingRevisionIds.has(rev.id)}
                title="Delete this revision"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#f87171",
                  fontSize: "calc(11px * var(--bs-font-scale, 1))",
                  cursor: deletingRevisionIds.has(rev.id) ? "wait" : "pointer",
                  padding: "1px 4px",
                }}
              >
                ✕
              </button>
            </div>
          ))
        )}
        {confirmDeleteRevision && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Delete layout revision "${confirmDeleteRevision.name}"`}
            data-testid={`confirm-delete-revision-dialog-${confirmDeleteRevision.id}`}
            onClick={(e) => e.stopPropagation()}
            style={{ marginTop: 8, padding: 10, border: "1px solid rgba(239,68,68,0.35)", borderRadius: 4, background: "rgba(127,29,29,0.16)" }}
          >
            <div style={{ color: "#fecaca", fontSize: "calc(12px * var(--bs-font-scale, 1))", marginBottom: 6 }}>
              Delete &quot;{confirmDeleteRevision.name}&quot;? This saved layout cannot be recovered.
            </div>
            {revisionDeleteError && (
              <div
                data-testid={`collection-revision-delete-error-${confirmDeleteRevision.id}`}
                role="alert"
                style={{ color: "#fca5a5", fontSize: "calc(11px * var(--bs-font-scale, 1))", marginBottom: 6 }}
              >
                {revisionDeleteError}
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                data-testid={`btn-cancel-delete-revision-${confirmDeleteRevision.id}`}
                onClick={() => setConfirmDeleteRevision(null)}
                disabled={deletingRevisionIds.has(confirmDeleteRevision.id)}
                style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 3, color: "#cbd5e1", fontSize: "calc(11px * var(--bs-font-scale, 1))", padding: "2px 8px", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                data-testid={`btn-confirm-delete-revision-${confirmDeleteRevision.id}`}
                onClick={() => void handleConfirmDeleteRevision()}
                disabled={deletingRevisionIds.has(confirmDeleteRevision.id)}
                style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.45)", borderRadius: 3, color: "#fca5a5", fontSize: "calc(11px * var(--bs-font-scale, 1))", padding: "2px 8px", cursor: deletingRevisionIds.has(confirmDeleteRevision.id) ? "wait" : "pointer" }}
              >
                {deletingRevisionIds.has(confirmDeleteRevision.id) ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
};
