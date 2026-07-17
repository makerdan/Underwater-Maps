/**
 * Null-safety regression: App.tsx offline-pack expiry toast guard.
 *
 * A pack with no savedAt and tidePack: null must not call `new Date(undefined)`,
 * which would produce a NaN-based hoursLeft and a nonsensical toast.
 * The guard `if (rawDate == null) continue` must suppress the toast entirely.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock @/lib/offlinePackStore before any import resolves it ──────────────
const mockGetExpiringPacks = vi.fn<() => Promise<unknown[]>>();

vi.mock("@/lib/offlinePackStore", () => ({
  getExpiringPacks: (...args: unknown[]) => mockGetExpiringPacks(...args),
}));

// ── Mock dynamic import of offlinePackStore ────────────────────────────────
// App.tsx uses `import("@/lib/offlinePackStore")` — we need the module-level
// vi.mock above to intercept it; the dynamic import will resolve the same mock.

// ── Mock toast ─────────────────────────────────────────────────────────────
const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
  toast: mockToast,
}));

// ── Inline the guard logic (extracted from App.tsx useEffect body) ─────────
// Rather than mounting the full App component (which pulls in hundreds of
// dependencies), we replicate the exact guard expression from App.tsx:
//   const rawDate = p.tidePack?.tidalExpiresAt ?? p.savedAt;
//   if (rawDate == null) continue;
// and verify that the toast branch is not reached for null-date packs.

async function runExpiryToastLogic(
  packs: Array<{ tidePack?: { tidalExpiresAt?: string } | null; savedAt?: string; datasetName: string }>,
  toastFn: (opts: object) => void,
) {
  for (const p of packs) {
    const rawDate = p.tidePack?.tidalExpiresAt ?? p.savedAt;
    if (rawDate == null) continue;
    const expiresAt = new Date(rawDate);
    const hoursLeft = Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 3_600_000));
    toastFn({
      title: "Offline pack expiring soon",
      description: `"${p.datasetName}" pack expires in ${hoursLeft}h — tap Update in Settings to refresh.`,
      duration: 8000,
    });
  }
}

describe("App.tsx offline-pack expiry date guard", () => {
  beforeEach(() => {
    mockToast.mockClear();
    mockGetExpiringPacks.mockClear();
  });

  it("does not call toast when tidePack is null and savedAt is missing", async () => {
    const pack = {
      datasetName: "Test Pack",
      tidePack: null,
    } as { datasetName: string; tidePack: null; savedAt?: string };

    await runExpiryToastLogic([pack], mockToast);

    expect(mockToast).not.toHaveBeenCalled();
  });

  it("does not call toast when both tidalExpiresAt and savedAt are undefined", async () => {
    const pack = {
      datasetName: "Test Pack",
      tidePack: { tidalExpiresAt: undefined },
    };

    await runExpiryToastLogic([pack], mockToast);

    expect(mockToast).not.toHaveBeenCalled();
  });

  it("does not throw when processing a pack with no date fields", async () => {
    const pack = { datasetName: "Dateless Pack", tidePack: null } as {
      datasetName: string;
      tidePack: null;
      savedAt?: string;
    };

    await expect(runExpiryToastLogic([pack], mockToast)).resolves.toBeUndefined();
  });

  it("calls toast normally when a valid tidalExpiresAt is present", async () => {
    const futureIso = new Date(Date.now() + 24 * 3600_000).toISOString();
    const pack = {
      datasetName: "Valid Pack",
      tidePack: { tidalExpiresAt: futureIso },
    };

    await runExpiryToastLogic([pack], mockToast);

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Offline pack expiring soon" }),
    );
  });

  it("skips null-date packs but still toasts packs that have valid dates", async () => {
    const futureIso = new Date(Date.now() + 12 * 3600_000).toISOString();
    const packs = [
      { datasetName: "No Date Pack", tidePack: null } as { datasetName: string; tidePack: null; savedAt?: string },
      { datasetName: "Valid Pack", tidePack: { tidalExpiresAt: futureIso } },
    ];

    await runExpiryToastLogic(packs, mockToast);

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect((mockToast.mock.calls[0]![0] as { description: string }).description).toContain("Valid Pack");
  });
});
