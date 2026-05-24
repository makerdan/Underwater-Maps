import { describe, it, expect } from "vitest";
import { POE_MODELS, MODEL_DEFAULTS, getModelDefaults } from "../models.js";

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
