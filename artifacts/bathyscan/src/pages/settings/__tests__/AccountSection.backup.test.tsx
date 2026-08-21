/**
 * AccountSection settings backup (import/export) regression tests.
 *
 * Covers (Task: settings import/export hardening):
 *   (a) invalid top-level JSON shape rejected; invalid fields skipped with a
 *       count in the inline message
 *   (b) syncedSnapshot / lastSyncedAt never written to the store on import
 *   (c) export payload contains only DEFAULT_SETTINGS keys + version
 *   (d) export button re-enables after triggerBlobDownload throws and successful exports confirm
 *   (e) flushServerSync rejection shows "Saved locally — cloud sync failed"
 *   (f) oversize files rejected before reading
 *   (g) import disabled while signed out (button + hint)
 *   (h) export-all aborts the download when the account changes mid-request
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// Mutable auth state read lazily at render time (avoids vi.mock TDZ issues).
const mockAuth: { user: { id: string; fullName: string } | null; isSignedIn: boolean } = {
  user: { id: "user-1", fullName: "Test Diver" },
  isSignedIn: true,
};

vi.mock("@/lib/clerkCompat", () => ({
  useUser: () => ({ user: mockAuth.user, isSignedIn: mockAuth.isSignedIn }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useDeleteMarkersMine: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const { vi: v } = await import("vitest");

  const setStateSpy = v.fn();
  const storeState = () => ({
    ...actual.DEFAULT_SETTINGS,
    lastSyncedAt: "2026-01-01T00:00:00Z",
    syncedSnapshot: { hudOpacity: 1 },
    // A representative action function — must never leak into exports.
    setHudOpacity: () => undefined,
  });

  const useSettingsStore = Object.assign(
    <T,>(sel: (s: ReturnType<typeof storeState>) => T): T => sel(storeState()),
    {
      getState: storeState,
      setState: setStateSpy,
      persist: { hasHydrated: () => true, onFinishHydration: () => () => {} },
      subscribe: () => () => {},
    },
  );

  return { ...actual, useSettingsStore, __setStateSpy: setStateSpy };
});

vi.mock("@/lib/authorizedFetch", () => ({
  authorizedFetch: vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob([]) }),
}));

vi.mock("@/lib/blobDownload", () => ({
  triggerBlobDownload: vi.fn(),
}));

vi.mock("@/hooks/useServerSettingsSync", () => ({
  flushServerSync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/pages/settings/components/SectionTitle", () => ({
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

import { AccountSection } from "../AccountSection";
import { triggerBlobDownload } from "@/lib/blobDownload";
import { authorizedFetch } from "@/lib/authorizedFetch";
import { flushServerSync } from "@/hooks/useServerSettingsSync";
import {
  DEFAULT_SETTINGS,
  // @ts-expect-error — test-only export injected by the module mock above
  __setStateSpy,
} from "@/lib/settingsStore";
import { SETTINGS_EXPORT_KEYS, MAX_IMPORT_FILE_BYTES } from "@/lib/settingsBackup";

const setStateSpy = __setStateSpy as ReturnType<typeof vi.fn>;

function getFileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error("file input not found");
  return input as HTMLInputElement;
}

function uploadJson(container: HTMLElement, contents: string, name = "backup.json"): void {
  const file = new File([contents], name, { type: "application/json" });
  fireEvent.change(getFileInput(container), { target: { files: [file] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.user = { id: "user-1", fullName: "Test Diver" };
  mockAuth.isSignedIn = true;
  vi.mocked(flushServerSync).mockResolvedValue(undefined);
  vi.mocked(authorizedFetch).mockResolvedValue({
    ok: true,
    blob: async () => new Blob([]),
  } as unknown as Response);
  vi.mocked(triggerBlobDownload).mockReset();
});

describe("export settings", () => {
  it("(c) export payload contains only DEFAULT_SETTINGS keys plus version", async () => {
    render(<AccountSection />);
    fireEvent.click(screen.getByTestId("export-settings-btn"));

    expect(triggerBlobDownload).toHaveBeenCalledTimes(1);
    const blob = vi.mocked(triggerBlobDownload).mock.calls[0]![0] as Blob;
    const payload = JSON.parse(await blob.text()) as Record<string, unknown>;

    const expected = [...SETTINGS_EXPORT_KEYS.map(String), "version"].sort();
    expect(Object.keys(payload).sort()).toEqual(expected);
    expect("syncedSnapshot" in payload).toBe(false);
    expect("lastSyncedAt" in payload).toBe(false);
    expect("setHudOpacity" in payload).toBe(false);
    expect(payload.version).toBe(1);
  });

  it("(d) export button re-enables and shows an error when the download throws", async () => {
    vi.mocked(triggerBlobDownload).mockImplementation(() => {
      throw new Error("boom");
    });
    render(<AccountSection />);
    const btn = screen.getByTestId("export-settings-btn");
    fireEvent.click(btn);

    expect(await screen.findByTestId("export-settings-msg")).toHaveTextContent(/export failed/i);
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveTextContent("EXPORT SETTINGS");

    // Still usable: a second click retries the export.
    vi.mocked(triggerBlobDownload).mockImplementation(() => undefined);
    fireEvent.click(btn);
    expect(triggerBlobDownload).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("export-settings-msg")).toHaveTextContent("✓ Downloaded");
  });
});

describe("import settings", () => {
  it("applies validated fields and reports success after the flush resolves", async () => {
    const { container } = render(<AccountSection />);
    uploadJson(container, JSON.stringify({ hudOpacity: 0.42, units: "imperial" }));

    await waitFor(() =>
      expect(screen.getByTestId("import-settings-msg")).toHaveTextContent(
        "✓ Settings imported and synced",
      ),
    );
    expect(setStateSpy).toHaveBeenCalledWith({ hudOpacity: 0.42, units: "imperial" });
    expect(flushServerSync).toHaveBeenCalledTimes(1);
  });

  it("(b) never writes syncedSnapshot / lastSyncedAt / _hasHydrated to the store", async () => {
    const { container } = render(<AccountSection />);
    uploadJson(
      container,
      JSON.stringify({
        hudOpacity: 0.9,
        syncedSnapshot: { hudOpacity: 0.1 },
        lastSyncedAt: "1999-01-01T00:00:00Z",
        _hasHydrated: false,
        schemaVersion: 1,
      }),
    );

    await waitFor(() => expect(setStateSpy).toHaveBeenCalled());
    const applied = setStateSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(applied).toEqual({ hudOpacity: 0.9 });
    expect("syncedSnapshot" in applied).toBe(false);
    expect("lastSyncedAt" in applied).toBe(false);
    expect("_hasHydrated" in applied).toBe(false);
    expect("schemaVersion" in applied).toBe(false);
  });

  it("(a) rejects a top-level array without touching the store", async () => {
    const { container } = render(<AccountSection />);
    uploadJson(container, JSON.stringify([1, 2, 3]));

    await waitFor(() =>
      expect(screen.getByTestId("import-settings-msg")).toHaveTextContent(/✗ .*array/i),
    );
    expect(setStateSpy).not.toHaveBeenCalled();
    expect(flushServerSync).not.toHaveBeenCalled();
  });

  it("(a) shows a skip count when some fields have unsupported values", async () => {
    const { container } = render(<AccountSection />);
    uploadJson(
      container,
      JSON.stringify({
        hudOpacity: 0.5,
        invertMouseY: "nope",
        colormapTheme: "neon-lava",
        someUnknownKey: 7,
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("import-settings-msg")).toHaveTextContent(
        "✓ Settings imported and synced (3 fields skipped: unsupported values)",
      ),
    );
    expect(setStateSpy).toHaveBeenCalledWith({ hudOpacity: 0.5 });
  });

  it("rejects invalid JSON text with an inline error", async () => {
    const { container } = render(<AccountSection />);
    uploadJson(container, "{not json!");

    await waitFor(() =>
      expect(screen.getByTestId("import-settings-msg")).toHaveTextContent(
        "✗ Invalid settings file",
      ),
    );
    expect(setStateSpy).not.toHaveBeenCalled();
  });

  it("(e) shows 'Saved locally — cloud sync failed' when the flush rejects", async () => {
    vi.mocked(flushServerSync).mockRejectedValue(new Error("PUT failed"));
    const { container } = render(<AccountSection />);
    uploadJson(container, JSON.stringify({ hudOpacity: 0.42 }));

    await waitFor(() =>
      expect(screen.getByTestId("import-settings-msg")).toHaveTextContent(
        "✗ Saved locally — cloud sync failed",
      ),
    );
    // Settings were still applied locally.
    expect(setStateSpy).toHaveBeenCalledWith({ hudOpacity: 0.42 });
    // Button recovered from the importing state.
    expect(screen.getByTestId("import-settings-btn")).toHaveTextContent("IMPORT SETTINGS");
  });

  it("(f) rejects oversize files before reading them", async () => {
    const { container } = render(<AccountSection />);
    const big = new File(
      [new Uint8Array(MAX_IMPORT_FILE_BYTES + 1)],
      "big.json",
      { type: "application/json" },
    );
    fireEvent.change(getFileInput(container), { target: { files: [big] } });

    await waitFor(() =>
      expect(screen.getByTestId("import-settings-msg")).toHaveTextContent(/file too large/i),
    );
    expect(setStateSpy).not.toHaveBeenCalled();
    expect(flushServerSync).not.toHaveBeenCalled();
  });

  it("(g) disables the import button and shows a hint while signed out", () => {
    mockAuth.user = null;
    mockAuth.isSignedIn = false;
    render(<AccountSection />);

    const btn = screen.getByTestId("import-settings-btn");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute(
      "title",
      "Sign in to import — changes will not be saved to your account.",
    );
    expect(screen.getByTestId("import-signed-out-hint")).toBeInTheDocument();
  });
});

describe("export all data", () => {
  it("(h) aborts the download when the signed-in user changes mid-request", async () => {
    let resolveFetch: (value: Response) => void = () => undefined;
    vi.mocked(authorizedFetch).mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { rerender } = render(<AccountSection />);
    fireEvent.click(screen.getByTestId("export-all-btn"));

    // Account transition while the request is in flight.
    mockAuth.user = { id: "user-2", fullName: "Someone Else" };
    rerender(<AccountSection />);

    await act(async () => {
      resolveFetch({
        ok: true,
        blob: async () => new Blob(["prior-account-data"]),
      } as unknown as Response);
    });

    await waitFor(() =>
      expect(screen.getByTestId("export-all-btn")).toHaveTextContent("EXPORT ALL DATA"),
    );
    expect(triggerBlobDownload).not.toHaveBeenCalled();
  });

  it("downloads normally when the user is unchanged", async () => {
    render(<AccountSection />);
    fireEvent.click(screen.getByTestId("export-all-btn"));

    await waitFor(() => expect(triggerBlobDownload).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("export-settings-msg")).toHaveTextContent("✓ Downloaded");
  });

  it("clears a local export error before an export-all retry starts", async () => {
    vi.mocked(triggerBlobDownload).mockImplementationOnce(() => {
      throw new Error("local export failed");
    });
    render(<AccountSection />);
    fireEvent.click(screen.getByTestId("export-settings-btn"));
    expect(await screen.findByTestId("export-settings-msg")).toHaveTextContent(/export failed/i);

    let resolveFetch: (value: Response) => void = () => undefined;
    vi.mocked(authorizedFetch).mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    fireEvent.click(screen.getByTestId("export-all-btn"));

    expect(screen.queryByTestId("export-settings-msg")).not.toBeInTheDocument();
    expect(screen.getByTestId("export-all-btn")).toHaveTextContent("EXPORTING…");

    await act(async () => {
      resolveFetch({
        ok: true,
        blob: async () => new Blob(["exported-data"]),
      } as unknown as Response);
    });
    await waitFor(() =>
      expect(screen.getByTestId("export-settings-msg")).toHaveTextContent("✓ Downloaded"),
    );
  });
});

describe("(sanity) DEFAULT_SETTINGS remains the export source of truth", () => {
  it("SETTINGS_EXPORT_KEYS is DEFAULT_SETTINGS minus lastSyncedAt", () => {
    const expected = Object.keys(DEFAULT_SETTINGS).filter((k) => k !== "lastSyncedAt").sort();
    expect([...SETTINGS_EXPORT_KEYS.map(String)].sort()).toEqual(expected);
  });
});
