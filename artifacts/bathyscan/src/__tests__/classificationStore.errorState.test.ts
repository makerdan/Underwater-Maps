/**
 * classificationStore.errorState.test.ts
 *
 * Confirms that when the AI classification action fails, the store's `error`
 * field is set to the categorized error object (not left null), making the
 * error available to UI consumers such as the classification panel.
 *
 * This is a regression guard for the surface-errors requirement: the error
 * must be present in store state (not just logged or shown via toast) so that
 * any panel reading `useClassificationStore(s => s.error)` can display it.
 *
 * Strategy:
 * - Same mock setup as classificationFailureToast.test.ts — mock fetch to 404
 *   (server cache miss) so poeClassify is always reached.
 * - Mock poeClassify to reject with various error payloads.
 * - After classify() resolves, assert useClassificationStore.getState().error
 *   is non-null and carries the expected categorized detail string.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

const { mockPoeClassify } = vi.hoisted(() => ({ mockPoeClassify: vi.fn() }));
const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() { return { data: undefined, isLoading: false, isError: false }; }
  function mutationHook() { return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined }; }
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

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/ui/toast", () => ({
  ToastAction: "button",
}));

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({ poeClassify: mockPoeClassify }),
);

import { useClassificationStore } from "@/lib/classificationStore";
import type { TerrainData } from "@workspace/api-client-react";

function makeGrid(seed = 1): TerrainData {
  const SIZE = 4;
  const depths = Array.from({ length: SIZE * SIZE }, (_, i) => -(i + 1) * seed);
  return {
    datasetId: `ds-err-state-${seed}`,
    waterType: "saltwater",
    width: SIZE, height: SIZE, resolution: SIZE,
    minDepth: -(SIZE * SIZE * seed), maxDepth: -seed,
    depths,
    minLon: -135, maxLon: -134, minLat: 57, maxLat: 58,
  } as unknown as TerrainData;
}

function mockFetchCacheMiss() {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
  );
}

beforeEach(() => {
  mockPoeClassify.mockReset();
  useClassificationStore.getState().clearZoneMap();
  vi.spyOn(globalThis, "crypto", "get").mockReturnValue({
    subtle: {
      digest: async (_: string, buf: ArrayBuffer) => {
        const view = new Uint8Array(buf);
        const hash = new Uint8Array(32);
        for (let i = 0; i < view.length; i++) hash[i % 32] ^= view[i]!;
        return hash.buffer;
      },
    },
  } as unknown as Crypto);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classificationStore — error field is set in store state on failure", () => {
  it("sets error to a non-null object after a generic network failure", async () => {
    mockFetchCacheMiss();
    mockPoeClassify.mockRejectedValue(new Error("Network request failed"));

    await useClassificationStore.getState().classify(makeGrid(1));

    const { error } = useClassificationStore.getState();
    expect(error).not.toBeNull();
    expect(typeof error?.detail).toBe("string");
    expect(error!.detail.length).toBeGreaterThan(0);
  });

  it("sets error.detail to a non-empty string for poe_point_balance_zero", async () => {
    mockFetchCacheMiss();
    mockPoeClassify.mockRejectedValue({
      status: 402,
      data: { error: "poe_point_balance_zero", details: "Balance exhausted" },
      message: "Payment Required",
    });

    await useClassificationStore.getState().classify(makeGrid(2));

    const { error } = useClassificationStore.getState();
    expect(error).not.toBeNull();
    expect(error!.detail).toMatch(/.+/);
  });

  it("sets error.detail for poe_circuit_open", async () => {
    mockFetchCacheMiss();
    mockPoeClassify.mockRejectedValue({
      status: 503,
      data: { error: "poe_circuit_open", details: "Circuit breaker open" },
      message: "Service Unavailable",
    });

    await useClassificationStore.getState().classify(makeGrid(3));

    const { error } = useClassificationStore.getState();
    expect(error).not.toBeNull();
    expect(error!.detail).toMatch(/.+/);
  });

  it("clears the error field when clearZoneMap is called after a failure", async () => {
    mockFetchCacheMiss();
    mockPoeClassify.mockRejectedValue(new Error("Network request failed"));

    await useClassificationStore.getState().classify(makeGrid(4));
    expect(useClassificationStore.getState().error).not.toBeNull();

    useClassificationStore.getState().clearZoneMap();

    expect(useClassificationStore.getState().error).toBeNull();
  });

  it("error field is null before any classification attempt", () => {
    const { error } = useClassificationStore.getState();
    expect(error).toBeNull();
  });
});
