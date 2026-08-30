import { describe, it, expect, vi } from "vitest";
import {
  POE_MODELS,
  MODEL_DEFAULTS,
  POE_ROUTE_REGISTRY,
  fetchPoeModelIds,
  getModelDefaults,
  parsePoeModelIds,
  selectPoeRoute,
  validatePoeRouteRequest,
} from "../models.js";
import {
  PoeCapabilityError,
  PoeModelRegistryError,
  PoeModelUnavailableError,
} from "../errors.js";

describe("POE_MODELS", () => {
  it("has required model keys", () => {
    expect(POE_MODELS.CLASSIFY).toBe("Claude-Sonnet-4.6");
    expect(POE_MODELS.DESCRIBE_QUICK).toBe("Claude-Haiku-4.5");
    expect(POE_MODELS.REASON_DEEP).toBe("Claude-Opus-4.7");
    expect(POE_MODELS.QUERY_TOOLS).toBe("Claude-Sonnet-4.6");
  });
});

describe("MODEL_DEFAULTS", () => {
  it("Claude-Sonnet-4.6 supports vision and tools", () => {
    const d = MODEL_DEFAULTS["Claude-Sonnet-4.6"]!;
    expect(d.supportsVision).toBe(true);
    expect(d.supportsTools).toBe(true);
    expect(d.supportsReasoning).toBe(true);
    expect(d.contextWindow).toBeGreaterThan(100_000);
  });

  it("Claude-Haiku-4.5 does not support reasoning", () => {
    const d = MODEL_DEFAULTS["Claude-Haiku-4.5"]!;
    expect(d.supportsReasoning).toBe(false);
  });

  it("DeepSeek-R1 does not support vision", () => {
    const d = MODEL_DEFAULTS["DeepSeek-R1"]!;
    expect(d.supportsVision).toBe(false);
    expect(d.supportsReasoning).toBe(true);
  });
});

describe("getModelDefaults", () => {
  it("returns defaults for known model", () => {
    const d = getModelDefaults("Claude-Opus-4.7");
    expect(d.supportsReasoning).toBe(true);
  });

  it("returns fallback for unknown model", () => {
    const d = getModelDefaults("Unknown-Model-99");
    expect(d.contextWindow).toBe(32_000);
    expect(d.supportsVision).toBe(false);
  });
});

describe("Poe capability registry", () => {
  it("has a live-verified registry entry for each production Poe route", () => {
    expect(Object.keys(POE_ROUTE_REGISTRY).sort()).toEqual([
      "classify",
      "help",
      "query",
      "upscale",
    ]);
    for (const entry of Object.values(POE_ROUTE_REGISTRY)) {
      expect(entry.modelId).toBeTruthy();
      expect(entry.endpoint).toMatch(/^(responses|chat\.completions)$/);
      expect(entry.verification.availability).toBe("requires-live-catalogue");
      expect(entry.verification.refreshBeforeUse).toBe(true);
    }
  });

  it("preserves exact live catalogue IDs and rejects a retired primary", () => {
    const payload = {
      object: "list",
      data: [{ id: "Claude-Sonnet-4.6" }, { id: "NewModel-With-Exact-Case" }],
    };
    expect(parsePoeModelIds(payload)).toEqual([
      "Claude-Sonnet-4.6",
      "NewModel-With-Exact-Case",
    ]);
    expect(() => selectPoeRoute("classify", ["claude-sonnet-4.6"])).toThrow(
      PoeModelUnavailableError,
    );
  });

  it("validates catalogue payloads without contacting Poe", () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "Claude-Haiku-4.5" }] }),
    });
    return expect(fetchPoeModelIds(fetcher)).resolves.toEqual(["Claude-Haiku-4.5"]).then(() => {
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.poe.com/v1/models");
    });
  });

  it("fails closed for malformed catalogue entries", () => {
    expect(() => parsePoeModelIds({ data: [{ name: "retired" }] })).toThrow(
      PoeModelRegistryError,
    );
    expect(() => parsePoeModelIds({ data: "not-an-array" })).toThrow(
      PoeModelRegistryError,
    );
  });

  it("rejects endpoint, capability, and parameter mismatches", () => {
    expect(() =>
      validatePoeRouteRequest({
        route: "classify",
        endpoint: "chat.completions",
        modelId: POE_MODELS.CLASSIFY,
      }),
    ).toThrow(PoeCapabilityError);
    expect(() =>
      validatePoeRouteRequest({
        route: "help",
        endpoint: "chat.completions",
        modelId: POE_MODELS.DESCRIBE_QUICK,
        requiredCapabilities: ["vision"],
      }),
    ).toThrow(PoeCapabilityError);
    expect(() =>
      validatePoeRouteRequest({
        route: "query",
        endpoint: "responses",
        modelId: POE_MODELS.QUERY_TOOLS,
        parameters: ["temperature", "unsupported_parameter"],
      }),
    ).toThrow(PoeCapabilityError);
  });

  it("selects only an explicit fallback and otherwise fails closed", () => {
    expect(selectPoeRoute("help", [], { allowFallback: true })).toMatchObject({
      provider: "openai",
      route: "help",
      modelId: "gpt-5",
    });
    expect(selectPoeRoute("classify", [POE_MODELS.CLASSIFY])).toMatchObject({
      provider: "poe",
      modelId: POE_MODELS.CLASSIFY,
    });
    expect(() => selectPoeRoute("query", [], { allowFallback: true })).toThrow(
      PoeModelUnavailableError,
    );
  });
});
