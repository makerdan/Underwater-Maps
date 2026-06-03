/**
 * Unit tests for the zone-classification failure toast in classificationStore.
 *
 * Covers:
 * - When poeClassify rejects with poe_point_balance_zero, the toast fires
 *   with title "Seafloor classification unavailable" and a description
 *   mentioning "Poe account balance", and includes a "Try again" action.
 * - When poeClassify rejects with poe_circuit_open, the toast fires with
 *   a description mentioning "temporarily unavailable" and includes a "Try again" action.
 * - When poeClassify rejects with a generic error, the toast fires with
 *   a description mentioning "Check your connection" and includes a "Try again" action.
 * - When poeClassify rejects with missing_key or unauthorized, the toast fires
 *   without a "Try again" action (retrying without fixing the key is pointless).
 * - lastFailedGrid is stored in state on any failure.
 * - When the server cache (GET /zones) returns 200, poeClassify is not
 *   called and no failure toast fires.
 *
 * Strategy:
 * - Mock @workspace/api-client-react so poeClassify is a vi.fn() we control.
 * - Mock global fetch to always return 404 (server cache miss) so tests
 *   always fall through to the poeClassify step.
 * - Mock @/hooks/use-toast so toast calls are captured.
 * - Mock @/components/ui/toast so ToastAction is a lightweight stub.
 * - Use a fresh Zustand store state (clearZoneMap) before each test.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));
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
  toast: mockToast,
  useToast: () => ({ toast: mockToast }),
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
    datasetId: `ds-classify-${seed}`,
    waterType: "saltwater",
    width: SIZE,
    height: SIZE,
    resolution: SIZE,
    minDepth: -(SIZE * SIZE * seed),
    maxDepth: -seed,
    depths,
    minLon: -135,
    maxLon: -134,
    minLat: 57,
    maxLat: 58,
  } as unknown as TerrainData;
}

function mockFetchCacheMiss() {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
  );
}

beforeEach(() => {
  mockToast.mockClear();
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

describe("classificationStore — zone classification failure toast", () => {
  it("fires toast with Poe balance description when poe_point_balance_zero error", async () => {
    mockFetchCacheMiss();
    mockPoeClassify.mockRejectedValue({
      status: 402,
      data: { error: "poe_point_balance_zero", details: "Poe balance exhausted" },
      message: "Payment Required",
    });

    await useClassificationStore.getState().classify(makeGrid(1));

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Seafloor classification unavailable",
        variant: "destructive",
        description: expect.stringMatching(/Poe account balance/i),
      }),
    );
  });

  it("fires toast with circuit-open description when poe_circuit_open error", async () => {
    mockFetchCacheMiss();
    mockPoeClassify.mockRejectedValue({
      status: 503,
      data: { error: "poe_circuit_open", details: "Circuit breaker open" },
      message: "Service Unavailable",
    });

    await useClassificationStore.getState().classify(makeGrid(2));

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Seafloor classification unavailable",
        variant: "destructive",
        description: expect.stringMatching(/temporarily unavailable/i),
      }),
    );
  });

  it("fires toast with 'Check your connection' description on generic network error", async () => {
    mockFetchCacheMiss();
    mockPoeClassify.mockRejectedValue(new Error("Network request failed"));

    await useClassificationStore.getState().classify(makeGrid(3));

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Seafloor classification unavailable",
        variant: "destructive",
        description: expect.stringMatching(/Check your connection/i),
      }),
    );
  });

  it("includes a 'Try again' action on poe_point_balance_zero toast", async () => {
    mockFetchCacheMiss();
    mockPoeClassify.mockRejectedValue({
      status: 402,
      data: { error: "poe_point_balance_zero", details: "Poe balance exhausted" },
      message: "Payment Required",
    });

    await useClassificationStore.getState().classify(makeGrid(5));

    const call = mockToast.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).toHaveProperty("action");
    expect(call.action).not.toBeNull();
    expect(call.action).not.toBeUndefined();
  });

  it("includes a 'Try again' action on poe_circuit_open toast", async () => {
    mockFetchCacheMiss();
    mockPoeClassify.mockRejectedValue({
      status: 503,
      data: { error: "poe_circuit_open", details: "Circuit breaker open" },
      message: "Service Unavailable",
    });

    await useClassificationStore.getState().classify(makeGrid(6));

    const call = mockToast.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).toHaveProperty("action");
    expect(call.action).not.toBeNull();
  });

  it("includes a 'Try again' action on generic network error toast", async () => {
    mockFetchCacheMiss();
    mockPoeClassify.mockRejectedValue(new Error("Network request failed"));

    await useClassificationStore.getState().classify(makeGrid(7));

    const call = mockToast.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).toHaveProperty("action");
    expect(call.action).not.toBeNull();
  });

  it("omits the 'Try again' action on missing_key toast", async () => {
    mockFetchCacheMiss();
    mockPoeClassify.mockRejectedValue({
      status: 500,
      data: { error: "poe_error", details: "POE_API_KEY environment variable is not set." },
      message: "Internal Server Error",
    });

    await useClassificationStore.getState().classify(makeGrid(8));

    expect(mockToast).toHaveBeenCalledTimes(1);
    const call = mockToast.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.action).toBeUndefined();
  });

  it("omits the 'Try again' action on unauthorized toast", async () => {
    mockFetchCacheMiss();
    mockPoeClassify.mockRejectedValue({
      status: 401,
      data: { error: "auth_error", details: "Invalid API key" },
      message: "Unauthorized",
    });

    await useClassificationStore.getState().classify(makeGrid(9));

    expect(mockToast).toHaveBeenCalledTimes(1);
    const call = mockToast.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.action).toBeUndefined();
  });

  it("stores the failed grid in lastFailedGrid state on any failure", async () => {
    mockFetchCacheMiss();
    const grid = makeGrid(10);
    mockPoeClassify.mockRejectedValue(new Error("Network request failed"));

    await useClassificationStore.getState().classify(grid);

    const { lastFailedGrid } = useClassificationStore.getState();
    expect(lastFailedGrid).not.toBeNull();
    expect(lastFailedGrid?.datasetId).toBe(grid.datasetId);
  });

  it("clears lastFailedGrid when clearZoneMap is called", async () => {
    mockFetchCacheMiss();
    mockPoeClassify.mockRejectedValue(new Error("Network request failed"));
    await useClassificationStore.getState().classify(makeGrid(11));

    useClassificationStore.getState().clearZoneMap();

    expect(useClassificationStore.getState().lastFailedGrid).toBeNull();
  });

  it("does not fire the failure toast when the server zone cache returns 200", async () => {
    const cached = {
      zones: Array.from({ length: 32 * 32 }, () => "sandy_shelf"),
      waterType: "saltwater",
      source: "ai",
      substrateFp: "00000000",
      coarseWidth: 32,
      coarseHeight: 32,
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(cached), { status: 200 }),
    );

    await useClassificationStore.getState().classify(makeGrid(4));

    expect(mockPoeClassify).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
  });
});
