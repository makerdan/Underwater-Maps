import { describe, it, expect } from "vitest";
import { buildVisionInput, buildMultiModalMessages, depthGridToBase64Png } from "../vision.js";
import type { TerrainGrid } from "../types.js";

describe("buildVisionInput", () => {
  it("returns two items: text then image", () => {
    const input = buildVisionInput("Describe this", "data:image/png;base64,abc123");
    expect(input).toHaveLength(2);
    expect(input[0]).toEqual({ type: "input_text", text: "Describe this" });
    expect(input[1]).toEqual({ type: "input_image", image_url: "data:image/png;base64,abc123" });
  });
});

describe("buildMultiModalMessages", () => {
  it("returns system + user messages", () => {
    const msgs = buildMultiModalMessages("System prompt", "User text", "data:image/png;base64,xyz");
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe("system");
    expect(msgs[1]?.role).toBe("user");
    expect(msgs[1]?.content).toHaveLength(2);
  });

  it("includes both text and image in user message", () => {
    const msgs = buildMultiModalMessages("sys", "user text", "data:image/jpeg;base64,foo");
    const user = msgs[1]!;
    const hasText = user.content.some((c) => c.type === "text" && c.text === "user text");
    const hasImage = user.content.some((c) => c.type === "image_url" && c.image_url?.url === "data:image/jpeg;base64,foo");
    expect(hasText).toBe(true);
    expect(hasImage).toBe(true);
  });
});

describe("depthGridToBase64Png", () => {
  function makeGrid(w: number, h: number, fill = 1000): TerrainGrid {
    const depths = new Float32Array(w * h).fill(fill);
    return { depths, width: w, height: h, minDepth: 0, maxDepth: 11000, lonMin: 0, lonMax: 1, latMin: 0, latMax: 1 };
  }

  it("returns a PNG data URL string", () => {
    const grid = makeGrid(4, 4);
    const result = depthGridToBase64Png(grid, 16);
    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it("output is a valid base64 string", () => {
    const grid = makeGrid(4, 4);
    const result = depthGridToBase64Png(grid, 16);
    const base64 = result.replace("data:image/png;base64,", "");
    expect(() => Buffer.from(base64, "base64")).not.toThrow();
  });

  it("starts with PNG magic bytes", () => {
    const grid = makeGrid(8, 8);
    const result = depthGridToBase64Png(grid, 16);
    const base64 = result.replace("data:image/png;base64,", "");
    const bytes = Buffer.from(base64, "base64");
    expect(bytes[0]).toBe(137);
    expect(bytes[1]).toBe(80);
    expect(bytes[2]).toBe(78);
    expect(bytes[3]).toBe(71);
  });

  it("flat depth grid produces uniform grey pixels", () => {
    const grid = makeGrid(4, 4, 5500);
    grid.minDepth = 0;
    grid.maxDepth = 11000;
    const result = depthGridToBase64Png(grid, 4);
    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it("works with min/max depth range of zero (avoids NaN)", () => {
    const grid = makeGrid(4, 4, 1000);
    grid.minDepth = 1000;
    grid.maxDepth = 1000;
    expect(() => depthGridToBase64Png(grid, 4)).not.toThrow();
  });

  it("handles a larger grid", () => {
    const grid = makeGrid(32, 32);
    const result = depthGridToBase64Png(grid, 64);
    expect(result.length).toBeGreaterThan(100);
  });
});
