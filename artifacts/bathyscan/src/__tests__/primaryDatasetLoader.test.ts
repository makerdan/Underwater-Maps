/**
 * primaryDatasetLoader.test.ts
 *
 * Unit tests for the checkDatasetIdMatch validation utility that guards the
 * primary-dataset loader (pending-pipeline useEffect in DatasetPanel) against
 * silently accepting a server response whose embedded datasetId does not match
 * the requested one.
 *
 * Regression guard: if checkDatasetIdMatch is removed or its rejection logic is
 * softened, these tests fail before the component change can ship — ensuring the
 * primary loader always enters an error state on a mismatched server response
 * rather than silently displaying the wrong dataset.
 */

import { describe, it, expect } from "vitest";
import { checkDatasetIdMatch } from "@/lib/datasetResponseValidation";

describe("checkDatasetIdMatch", () => {
  // ── Happy path ─────────────────────────────────────────────────────────────

  it("returns ok:true when both terrain and overview IDs match the requested ID", () => {
    const result = checkDatasetIdMatch(
      "alaska-fjord",
      { datasetId: "alaska-fjord" },
      { datasetId: "alaska-fjord" },
    );
    expect(result).toEqual({ ok: true });
  });

  // ── Terrain mismatch ───────────────────────────────────────────────────────

  it("returns ok:false when terrain datasetId does not match the requested ID", () => {
    const result: DatasetIdMatchResult = checkDatasetIdMatch(
      "alaska-fjord",
      { datasetId: "lake-michigan" },
      { datasetId: "alaska-fjord" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Message should name the mismatched ID so developers can diagnose the issue.
      expect(result.message).toContain("lake-michigan");
      expect(result.message).toContain("alaska-fjord");
    }
  });

  it("returns ok:false with a message that identifies the mismatch direction (terrain)", () => {
    const result = checkDatasetIdMatch(
      "requested-id",
      { datasetId: "wrong-id" },
      { datasetId: "requested-id" },
    );
    expect(result).toMatchObject({ ok: false });
    expect((result as { ok: false; message: string }).message).toMatch(/terrain/i);
  });

  it("returns ok:false when terrain datasetId is undefined", () => {
    const result = checkDatasetIdMatch(
      "alaska-fjord",
      { /* datasetId omitted */ },
      { datasetId: "alaska-fjord" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // "(none)" placeholder keeps the message useful without throwing.
      expect(result.message).toContain("(none)");
    }
  });

  // ── Overview mismatch ──────────────────────────────────────────────────────

  it("returns ok:false when overview datasetId does not match the requested ID", () => {
    const result: DatasetIdMatchResult = checkDatasetIdMatch(
      "alaska-fjord",
      { datasetId: "alaska-fjord" },
      { datasetId: "lake-michigan" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("lake-michigan");
    }
  });

  it("returns ok:false with a message that identifies the mismatch direction (overview)", () => {
    const result = checkDatasetIdMatch(
      "requested-id",
      { datasetId: "requested-id" },
      { datasetId: "other-id" },
    );
    expect(result).toMatchObject({ ok: false });
    expect((result as { ok: false; message: string }).message).toMatch(/overview/i);
  });

  it("returns ok:false when overview datasetId is undefined", () => {
    const result = checkDatasetIdMatch(
      "alaska-fjord",
      { datasetId: "alaska-fjord" },
      { /* datasetId omitted */ },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("(none)");
    }
  });

  // ── Both missing ───────────────────────────────────────────────────────────

  it("returns ok:false when both IDs are undefined (terrain mismatch fires first)", () => {
    const result = checkDatasetIdMatch("alaska-fjord", {}, {});
    expect(result.ok).toBe(false);
    // Terrain check runs before overview; message should reference terrain.
    expect((result as { ok: false; message: string }).message).toMatch(/terrain/i);
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it("is case-sensitive — IDs that differ only by case are rejected", () => {
    const result = checkDatasetIdMatch(
      "Alaska-Fjord",
      { datasetId: "alaska-fjord" },
      { datasetId: "Alaska-Fjord" },
    );
    expect(result.ok).toBe(false);
  });

  it("handles IDs with special characters without throwing", () => {
    const id = "user/dataset:v2 (2024)";
    const result = checkDatasetIdMatch(
      id,
      { datasetId: id },
      { datasetId: id },
    );
    expect(result).toEqual({ ok: true });
  });
});
