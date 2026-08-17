/**
 * dataset-priority-bbox-sync.test.ts
 *
 * Drift guard: every id registered in DATASET_SOURCE_PRIORITY must have a
 * coverage bbox available to resolveDatasetBbox (markers route), sourced from
 * either BUNDLED_COVERAGE_BBOXES or ALL_PRESET_DATASETS.
 *
 * Without this guard, adding a new dataset id to DATASET_SOURCE_PRIORITY
 * without a corresponding bbox entry causes resolveDatasetBbox to fall through
 * to "not_found", making every POST /api/markers for that dataset return 404.
 *
 * Runs in the fast validation tier — no network, no DB, pure static check.
 */

import { describe, it, expect } from "vitest";
import {
  DATASET_SOURCE_PRIORITY,
  BUNDLED_COVERAGE_BBOXES,
  ALL_PRESET_DATASETS,
} from "../terrain.js";

describe("DATASET_SOURCE_PRIORITY ↔ bbox coverage sync guard", () => {
  /**
   * Build the full set of covered ids:
   *   - every key in BUNDLED_COVERAGE_BBOXES
   *   - every id in ALL_PRESET_DATASETS (each carries a bbox field)
   */
  const coveredIds = new Set<string>([
    ...Object.keys(BUNDLED_COVERAGE_BBOXES),
    ...ALL_PRESET_DATASETS.map((d) => d.id),
  ]);

  const priorityIds = Object.keys(DATASET_SOURCE_PRIORITY);

  it("there is at least one entry in DATASET_SOURCE_PRIORITY (sanity check)", () => {
    expect(priorityIds.length).toBeGreaterThan(0);
  });

  it("every DATASET_SOURCE_PRIORITY id has a bbox in BUNDLED_COVERAGE_BBOXES or ALL_PRESET_DATASETS", () => {
    const missing = priorityIds.filter((id) => !coveredIds.has(id));

    expect(
      missing,
      "The following dataset ids appear in DATASET_SOURCE_PRIORITY but have no " +
        "coverage bbox in either BUNDLED_COVERAGE_BBOXES or ALL_PRESET_DATASETS.\n" +
        "Fix: add a matching entry in BUNDLED_COVERAGE_BBOXES (terrain.ts) or " +
        "ensure the DatasetMeta entry in ALL_PRESET_DATASETS carries a bbox.\n" +
        "Without a bbox, POST /api/markers for these datasets returns 404.\n" +
        "Missing ids:\n" +
        missing.map((id) => `  - "${id}"`).join("\n"),
    ).toHaveLength(0);
  });

  it("BUNDLED_COVERAGE_BBOXES has no orphan keys absent from DATASET_SOURCE_PRIORITY and ALL_PRESET_DATASETS (stale entry guard)", () => {
    const allKnownIds = new Set<string>([
      ...priorityIds,
      ...ALL_PRESET_DATASETS.map((d) => d.id),
    ]);

    const orphans = Object.keys(BUNDLED_COVERAGE_BBOXES).filter(
      (id) => !allKnownIds.has(id),
    );

    expect(
      orphans,
      "The following ids appear in BUNDLED_COVERAGE_BBOXES but are not in " +
        "DATASET_SOURCE_PRIORITY or ALL_PRESET_DATASETS — they are stale and " +
        "should be removed from BUNDLED_COVERAGE_BBOXES (terrain.ts).\n" +
        "Orphan ids:\n" +
        orphans.map((id) => `  - "${id}"`).join("\n"),
    ).toHaveLength(0);
  });
});
