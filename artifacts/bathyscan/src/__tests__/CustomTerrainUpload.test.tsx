/**
 * CustomTerrainUpload.test.tsx
 *
 * Verifies that when the POST /datasets/upload route responds with 422 and a
 * `details` field, the CustomTerrainUpload component displays that exact string
 * in the error area below the dropzone.
 *
 * Done-looks-like (task-1202):
 *  - onError with { data: { details: "...", error: "parse_error" } }
 *    → error message rendered inside the dropzone area
 *  - `detail` (singular, the old bug) is also extracted as a fallback
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, act } from "@testing-library/react";
import { CustomTerrainUpload } from "@/components/CustomTerrainUpload";

// ── Hoisted state: lets tests control the mutation outcome ────────────────────
//
// vi.hoisted runs before vi.mock hoisting and before any imports resolve, so
// the returned value is safely usable inside the synchronous vi.mock factory.

const uploadMock = vi.hoisted(() => {
  // Capture the { onError, onSuccess } callbacks passed to mutate().
  let pendingCallbacks: {
    onError?: (err: unknown) => void;
    onSuccess?: (data: unknown) => void;
  } = {};

  const mutate = vi.fn(
    (
      _variables: unknown,
      cbs?: { onError?: (err: unknown) => void; onSuccess?: (data: unknown) => void },
    ) => {
      pendingCallbacks = cbs ?? {};
    },
  );

  return {
    mutate,
    getCallbacks: () => pendingCallbacks,
    reset: () => {
      pendingCallbacks = {};
      mutate.mockClear();
    },
  };
});

// Capture the onDrop callback that CustomTerrainUpload passes to useDropzone.
const dropzoneMock = vi.hoisted(() => {
  let capturedOnDrop:
    | ((accepted: File[], rejected: unknown[]) => void)
    | null = null;

  return {
    triggerDrop: (files: File[]) => capturedOnDrop?.(files, []),
    setup(
      onDrop: (accepted: File[], rejected: unknown[]) => void,
    ) {
      capturedOnDrop = onDrop;
    },
  };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("react-dropzone", () => ({
  useDropzone: (opts: {
    onDrop: (accepted: File[], rejected: unknown[]) => void;
    disabled?: boolean;
  }) => {
    dropzoneMock.setup(opts.onDrop);
    return {
      getRootProps: () => ({ "data-testid": "dropzone-terrain" }),
      getInputProps: () => ({}),
      isDragActive: false,
    };
  },
}));

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    setDatasetId: vi.fn(),
    setTerrain: vi.fn(),
  }),
}));

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat({ useAuth: () => ({ isSignedIn: false, isLoaded: true }) });
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}));

vi.mock("@/lib/terrainStore", () => ({
  useTerrainStore: {
    getState: () => ({ setGrids: vi.fn() }),
  },
}));

vi.mock("@/lib/classificationStore", () => ({
  useClassificationStore: {
    getState: () => ({ clearZoneMap: vi.fn(), classify: vi.fn() }),
  },
}));

vi.mock("@/lib/offlineStore", () => ({
  useOfflineStore: (sel: (s: { isOnline: boolean }) => unknown) =>
    sel({ isOnline: true }),
}));

vi.mock("@workspace/api-client-react", () => ({
  usePostDatasetsUpload: () => ({
    mutate: uploadMock.mutate,
    isPending: false,
    isSuccess: false,
  }),
  getGetUserDatasetsQueryKey: () => ["user-datasets"],
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CustomTerrainUpload — 422 parse error display", () => {
  beforeEach(() => {
    uploadMock.reset();
  });

  it("shows the server details string when a 422 parse_error is returned for a GPX file", async () => {
    render(<CustomTerrainUpload />);

    const file = new File(
      ["<gpx><trk><trkseg><trkpt lat='55' lon='10'/></trkseg></trk></gpx>"],
      "track.gpx",
      { type: "application/gpx+xml" },
    );

    // Trigger drop → uploadFile() → mutate() is called
    act(() => {
      dropzoneMock.triggerDrop([file]);
    });

    expect(uploadMock.mutate).toHaveBeenCalledTimes(1);

    // Simulate server responding with 422 and a details string
    await act(async () => {
      uploadMock.getCallbacks().onError?.({
        data: {
          error: "parse_error",
          details: "GPX file contains no elevation/depth track points.",
        },
      });
    });

    // The component renders uploadError below the dropzone
    expect(
      screen.getByText(/GPX file contains no elevation\/depth track points\./i),
    ).toBeInTheDocument();
  });

  it("shows the server details string when a 422 parse_error is returned for an NMEA file", async () => {
    render(<CustomTerrainUpload />);

    const file = new File(
      ["$GPGGA,...\n"],
      "log.nmea",
      { type: "text/plain" },
    );

    act(() => {
      dropzoneMock.triggerDrop([file]);
    });

    await act(async () => {
      uploadMock.getCallbacks().onError?.({
        data: {
          error: "parse_error",
          details: "NMEA: no depth+position pairs found in the file.",
        },
      });
    });

    expect(
      screen.getByText(/NMEA: no depth\+position pairs found in the file\./i),
    ).toBeInTheDocument();
  });

  it("falls back to the legacy `detail` (singular) field if `details` is absent", async () => {
    render(<CustomTerrainUpload />);

    const file = new File(["data"], "survey.gpx", { type: "application/gpx+xml" });

    act(() => {
      dropzoneMock.triggerDrop([file]);
    });

    await act(async () => {
      uploadMock.getCallbacks().onError?.({
        data: {
          error: "parse_error",
          // old field name — frontend checks both via `e?.data?.detail ?? e?.data?.details`
          detail: "No elevation points found (legacy field).",
        },
      });
    });

    expect(
      screen.getByText(/No elevation points found \(legacy field\)\./i),
    ).toBeInTheDocument();
  });

  it("falls back to err.message when neither detail nor details is present", async () => {
    render(<CustomTerrainUpload />);

    const file = new File(["data"], "survey.gpx", { type: "application/gpx+xml" });

    act(() => {
      dropzoneMock.triggerDrop([file]);
    });

    await act(async () => {
      uploadMock.getCallbacks().onError?.(
        new Error("Network request failed"),
      );
    });

    expect(screen.getByText(/Network request failed/i)).toBeInTheDocument();
  });
});
