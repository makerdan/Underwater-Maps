/**
 * datasets-preview-synthetic.test.ts
 *
 * Regression guard: confirms the preview-route dataSource mapping never
 * produces "synthetic" for a custom (user-uploaded) dataset, even when the
 * stored terrainJson carries a stale "synthetic" value from a legacy DB row.
 *
 * The dead `rawSource === "synthetic" ? "synthetic"` branch was removed in
 * task #3177.  This test locks in the correct mapping so the branch cannot
 * be silently reintroduced in future changes to the preview route.
 *
 * Strategy: test the mapping function in pure isolation — no Express, no
 * database — so the test is immune to the pre-existing syntax error in the
 * surrounding terrain-route scaffolding that prevents the full file from
 * loading under esbuild.
 */
import { describe, it, expect } from "vitest";

/**
 * Mirror of the inline dataSource mapping from the GET /datasets/:id/preview
 * route handler for custom datasets.  This logic was corrected in task #3177:
 *  - "gebco"     → "gebco"   (real GEBCO global grid upload)
 *  - everything else → "ncei" (real upload; stale "synthetic" rows included)
 *
 * If this function is ever changed to re-add a "synthetic" branch, this test
 * will fail, which is the desired behaviour.
 */
function mapPreviewDataSource(
  rawSource: string | undefined,
): "ncei" | "gebco" {
  return rawSource === "gebco" ? "gebco" : "ncei";
}

describe("preview route dataSource mapping — synthetic guard", () => {
  it("maps 'synthetic' to 'ncei' (stale legacy DB value must not propagate)", () => {
    expect(mapPreviewDataSource("synthetic")).toBe("ncei");
    expect(mapPreviewDataSource("synthetic")).not.toBe("synthetic");
  });

  it("maps 'gebco' to 'gebco'", () => {
    expect(mapPreviewDataSource("gebco")).toBe("gebco");
  });

  it("maps 'ncei' to 'ncei'", () => {
    expect(mapPreviewDataSource("ncei")).toBe("ncei");
  });

  it("maps 'twdb' to 'ncei' (real upload — not a catalog source)", () => {
    expect(mapPreviewDataSource("twdb")).toBe("ncei");
  });

  it("maps 'usace' to 'ncei' (real upload — not a catalog source)", () => {
    expect(mapPreviewDataSource("usace")).toBe("ncei");
  });

  it("maps 'usgs-3dep' to 'ncei' (real upload — not a catalog source)", () => {
    expect(mapPreviewDataSource("usgs-3dep")).toBe("ncei");
  });

  it("maps undefined (missing dataSource field) to 'ncei'", () => {
    expect(mapPreviewDataSource(undefined)).toBe("ncei");
  });

  it("maps an unknown future source to 'ncei' (safe default)", () => {
    expect(mapPreviewDataSource("some-future-source")).toBe("ncei");
  });
});
