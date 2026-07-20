/**
 * Tests that the notes character limit is consistent between:
 *  - markerNotesSchema (Zod validation)
 *  - MarkerForm textarea (UI maxLength attribute)
 *
 * If the two drift apart, users see confusing validation errors on submit
 * even though the browser allowed them to type the input.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./setup";
import { MarkerForm } from "@/components/MarkerForm";
import { markerNotesSchema, MARKER_NOTES_MAX } from "@/lib/markerFormSchema";
import { useMarkerEditStore } from "@/lib/markerEditStore";

const UI_NOTES_MAX = 2000;

// ── API client proxy (hoisted) ────────────────────────────────────────────────
const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() {
    return { data: undefined, isLoading: false, isError: false };
  }
  function mutationHook() {
    return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined };
  }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally") return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) => `/api/mock/${a.filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

vi.mock("@/lib/cameraStore", () => ({
  useCameraStore: (sel: (s: { lastClickedGps: null }) => unknown) =>
    sel({ lastClickedGps: null }),
}));

vi.mock("@/lib/uiStore", () => {
  const state = { setMarkerFormOpen: vi.fn(), markerFormPrefill: null };
  return {
    useUiStore: Object.assign(
      (sel: (s: typeof state) => unknown) => sel(state),
      { getState: () => state },
    ),
  };
});

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    terrain: {
      datasetId: "test-dataset",
      waterType: "saltwater",
      minDepth: 5,
      maxDepth: 350,
      rows: 10,
      cols: 10,
    },
  }),
}));

vi.mock("@/lib/offlineStore", () => ({
  useOfflineStore: (sel: (s: { isOnline: boolean }) => unknown) => sel({ isOnline: true }),
}));

vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: (sel: (s: { units: string; waterType: string }) => unknown) =>
    sel({ units: "metric", waterType: "saltwater" }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("idb-keyval", () => ({ set: vi.fn() }));

vi.mock(
  "@workspace/api-client-react",
  () =>
    makeApiClientMock({
      getGetMarkersQueryKey: (params: unknown) => ["Markers", params],
      MarkerInputType: { custom: "custom" },
    }),
);

const SAMPLE_MARKER = {
  id: "m-test",
  datasetId: "test-dataset",
  type: "custom",
  label: "Test marker",
  notes: "Some notes",
  lon: -120.0,
  lat: 45.0,
  depth: 50,
  createdAt: "2024-01-01T00:00:00Z",
};

// ── markerNotesSchema character limit ────────────────────────────────────────
describe("markerNotesSchema — character limit", () => {
  it(`exports MARKER_NOTES_MAX as ${UI_NOTES_MAX}`, () => {
    expect(MARKER_NOTES_MAX).toBe(UI_NOTES_MAX);
  });

  it(`rejects notes longer than ${UI_NOTES_MAX} characters after trimming`, () => {
    expect(markerNotesSchema.safeParse("a".repeat(UI_NOTES_MAX + 1)).success).toBe(false);
  });

  it(`accepts notes exactly at the ${UI_NOTES_MAX}-character limit`, () => {
    expect(markerNotesSchema.safeParse("a".repeat(UI_NOTES_MAX)).success).toBe(true);
  });

  it(`schema max and UI cap agree — both equal ${UI_NOTES_MAX}`, () => {
    const over = "a".repeat(UI_NOTES_MAX + 1);
    const at = "a".repeat(UI_NOTES_MAX);
    expect(markerNotesSchema.safeParse(over).success).toBe(false);
    expect(markerNotesSchema.safeParse(at).success).toBe(true);
  });
});

// ── MarkerForm textarea maxLength ─────────────────────────────────────────────
describe("MarkerForm — notes textarea maxLength", () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useMarkerEditStore.getState().open(SAMPLE_MARKER as any);
  });

  afterEach(() => {
    useMarkerEditStore.getState().close();
  });

  it(`notes textarea has maxLength of ${UI_NOTES_MAX}`, () => {
    renderWithProviders(<MarkerForm />);
    const textarea = screen.getByPlaceholderText(
      /Good rockfish spot/i,
    ) as HTMLTextAreaElement;
    expect(textarea.maxLength).toBe(UI_NOTES_MAX);
  });

  it("notes textarea maxLength matches the schema MARKER_NOTES_MAX constant", () => {
    renderWithProviders(<MarkerForm />);
    const textarea = screen.getByPlaceholderText(
      /Good rockfish spot/i,
    ) as HTMLTextAreaElement;
    expect(textarea.maxLength).toBe(MARKER_NOTES_MAX);
  });
});
