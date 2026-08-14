import { describe, it, expect } from "vitest";
import { sortByRecency } from "@/lib/terrainStore";

function makeDataset(
  datasetId: string,
  dataUpdatedAt?: string | null,
): VisibleDataset {
  return {
    datasetId,
    source: "preset",
    activeGrid: null,
    overviewGrid: null,
    dataUpdatedAt,
  };
}

describe("sortByRecency", () => {
  it("returns an empty array unchanged", () => {
    expect(sortByRecency([])).toEqual([]);
  });

  it("returns a single-element array unchanged", () => {
    const ds = [makeDataset("a", "2022-01-01")];
    expect(sortByRecency(ds)).toEqual(ds);
  });

  it("sorts older date first, newer date last", () => {
    const older = makeDataset("old", "2020-06-15");
    const newer = makeDataset("new", "2023-11-01");
    const sorted = sortByRecency([newer, older]);
    expect(sorted.map((d) => d.datasetId)).toEqual(["old", "new"]);
  });

  it("puts null dataUpdatedAt before any dated entry", () => {
    const dated = makeDataset("dated", "2021-01-01");
    const nodDate = makeDataset("no-date", null);
    const sorted = sortByRecency([dated, nodDate]);
    expect(sorted[0]!.datasetId).toBe("no-date");
    expect(sorted[1]!.datasetId).toBe("dated");
  });

  it("puts undefined dataUpdatedAt before any dated entry", () => {
    const dated = makeDataset("dated", "2021-01-01");
    const undef = makeDataset("undef"); // no dataUpdatedAt key
    const sorted = sortByRecency([dated, undef]);
    expect(sorted[0]!.datasetId).toBe("undef");
    expect(sorted[1]!.datasetId).toBe("dated");
  });

  it("groups multiple null/undefined entries before dated entries", () => {
    const a = makeDataset("a", null);
    const b = makeDataset("b", undefined);
    const c = makeDataset("c", "2019-01-01");
    const d = makeDataset("d", "2024-06-01");
    const sorted = sortByRecency([d, c, b, a]);
    const ids = sorted.map((x) => x.datasetId);
    // All undated come before dated; dated sorted oldest-first
    expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("c"));
    expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("c"));
    expect(ids.indexOf("c")).toBeLessThan(ids.indexOf("d"));
  });

  it("is stable: entries with equal dates preserve original order", () => {
    const a = makeDataset("first", "2022-03-01");
    const b = makeDataset("second", "2022-03-01");
    const sorted = sortByRecency([a, b]);
    expect(sorted.map((d) => d.datasetId)).toEqual(["first", "second"]);

    const sorted2 = sortByRecency([b, a]);
    expect(sorted2.map((d) => d.datasetId)).toEqual(["second", "first"]);
  });

  it("is stable: multiple null entries preserve original order", () => {
    const a = makeDataset("x", null);
    const b = makeDataset("y", null);
    expect(sortByRecency([a, b]).map((d) => d.datasetId)).toEqual(["x", "y"]);
    expect(sortByRecency([b, a]).map((d) => d.datasetId)).toEqual(["y", "x"]);
  });

  it("sorts three datasets by date correctly", () => {
    const early = makeDataset("early", "2018-01-01");
    const mid = makeDataset("mid", "2021-06-15");
    const late = makeDataset("late", "2024-12-31");
    const sorted = sortByRecency([late, early, mid]);
    expect(sorted.map((d) => d.datasetId)).toEqual(["early", "mid", "late"]);
  });

  it("does not mutate the original array", () => {
    const datasets = [
      makeDataset("b", "2023-01-01"),
      makeDataset("a", "2020-01-01"),
    ];
    const original = [...datasets];
    sortByRecency(datasets);
    expect(datasets[0]!.datasetId).toBe(original[0]!.datasetId);
    expect(datasets[1]!.datasetId).toBe(original[1]!.datasetId);
  });
});
