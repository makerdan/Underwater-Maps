/**
 * FileUpload.dropzone.test.tsx
 *
 * Regression guard for two UX audit findings (F-007 / F-008):
 *
 * F-007 — onDropRejected was missing: unsupported-type and multi-file drops
 *          produced no user feedback.
 * F-008 — SUPPORTED_EXTENSIONS listed .pdf but the accept map had no
 *          application/pdf entry, so the drop-zone silently rejected PDFs.
 *
 * Covers:
 *   (a) dropping an unsupported file type → inline error message
 *   (b) dropping multiple files at once  → "Drop one file at a time"
 *   (c) dropping an accepted single file → error is cleared (not shown)
 *   (d) SUPPORTED_EXTENSIONS and ACCEPT_MAP agree on every extension
 *       (prevents the F-008 mismatch from recurring)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, act } from "@testing-library/react";
import type { FileRejection } from "react-dropzone";
import {
  FileUpload,
  SUPPORTED_EXTENSIONS,
  ACCEPT_MAP,
} from "@/components/FileUpload";

// ── Hoisted mock state ────────────────────────────────────────────────────────

const dropzoneMock = vi.hoisted(() => {
  type Callbacks = {
    onDrop?: (accepted: File[]) => void;
    onDropRejected?: (rejections: FileRejection[]) => void;
    onDragEnter?: () => void;
  };
  let cbs: Callbacks = {};
  return {
    setup(incoming: Callbacks) {
      cbs = incoming;
    },
    triggerDrop(files: File[]) {
      cbs.onDrop?.(files);
    },
    triggerRejected(rejections: FileRejection[]) {
      cbs.onDropRejected?.(rejections);
    },
    triggerDragEnter() {
      cbs.onDragEnter?.();
    },
  };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("react-dropzone", () => ({
  useDropzone: (opts: {
    onDrop?: (accepted: File[]) => void;
    onDropRejected?: (rejections: FileRejection[]) => void;
    onDragEnter?: () => void;
  }) => {
    dropzoneMock.setup({
      onDrop: opts.onDrop,
      onDropRejected: opts.onDropRejected,
      onDragEnter: opts.onDragEnter,
    });
    return {
      getRootProps: () => ({ "data-testid": "dropzone-terrain" }),
      getInputProps: () => ({}),
      isDragActive: false,
    };
  },
}));

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    setTerrain: vi.fn(),
    setDatasetId: vi.fn(),
    setPendingExternalUserDatasetId: vi.fn(),
  }),
}));

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat({ useAuth: () => ({ isSignedIn: true, isLoaded: true }) });
});

vi.mock("@workspace/api-client-react", () => ({
  usePostDatasetsUpload: () => ({
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRejection(code: string, filename = "bad.exe"): FileRejection {
  return {
    file: new File([], filename),
    errors: [{ code, message: code }],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("FileUpload — drop-zone rejection feedback (F-007)", () => {
  beforeEach(() => {
    render(<FileUpload />);
  });

  it("(a) shows an inline error for an unsupported file type", () => {
    act(() => {
      dropzoneMock.triggerRejected([makeRejection("file-invalid-type", "photo.png")]);
    });

    const error = screen.getByText(/unsupported file type/i);
    expect(error).toBeInTheDocument();
    // Message should name at least one accepted extension from SUPPORTED_EXTENSIONS
    expect(error.textContent).toContain(".csv");
  });

  it("(b) shows 'Drop one file at a time' when multiple files are dropped", () => {
    act(() => {
      dropzoneMock.triggerRejected([
        makeRejection("too-many-files", "a.csv"),
        makeRejection("too-many-files", "b.csv"),
      ]);
    });

    expect(screen.getByText(/drop one file at a time/i)).toBeInTheDocument();
  });

  it("(c) does NOT show an error after an accepted single-file drop", () => {
    // First set an error so we verify it is cleared
    act(() => {
      dropzoneMock.triggerRejected([makeRejection("file-invalid-type", "bad.exe")]);
    });
    expect(screen.getByText(/unsupported file type/i)).toBeInTheDocument();

    // Now drop a valid file — error should disappear
    act(() => {
      dropzoneMock.triggerDrop([new File(["lat,lon,depth\n1,2,3"], "survey.csv", { type: "text/csv" })]);
    });

    expect(screen.queryByText(/unsupported file type/i)).toBeNull();
  });

  it("clears a stale rejection error when the user starts a new drag (onDragEnter)", () => {
    act(() => {
      dropzoneMock.triggerRejected([makeRejection("file-invalid-type", "bad.exe")]);
    });
    expect(screen.getByText(/unsupported file type/i)).toBeInTheDocument();

    act(() => {
      dropzoneMock.triggerDragEnter();
    });

    expect(screen.queryByText(/unsupported file type/i)).toBeNull();
  });
});

describe("FileUpload — accept-map / display-string agreement (F-008)", () => {
  it("(d) every extension in SUPPORTED_EXTENSIONS appears in ACCEPT_MAP", () => {
    // Flatten all extensions from every MIME entry into a unique set
    const mappedExtensions = new Set(
      Object.values(ACCEPT_MAP).flat(),
    );

    // Parse the display string: ".csv, .xyz, ..." → [".csv", ".xyz", ...]
    const displayedExtensions = SUPPORTED_EXTENSIONS.split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const missing = displayedExtensions.filter((ext) => !mappedExtensions.has(ext));

    expect(missing).toEqual([]);
  });
});
