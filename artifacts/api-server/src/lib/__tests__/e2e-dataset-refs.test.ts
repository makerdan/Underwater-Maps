import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { ALL_PRESET_DATASETS } from "../terrain.js";

/**
 * Guard (Task: Ray Roberts TOPO badge e2e failures) — every preset dataset id
 * referenced by an e2e spec via a `btn-dataset-<id>` test-id literal must
 * exist in the seeded catalog (ALL_PRESET_DATASETS). Without this guard, a
 * catalog rename/dedup silently turns into a 15-second locator timeout deep
 * inside an e2e run; with it, the rename fails fast in the unit tier with a
 * clear message.
 *
 * Ids seeded purely through `__bathyTest.seedTerrain()` (e.g. mariana-trench)
 * never appear as `btn-dataset-` literals, so they are not affected.
 */

const E2E_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../tests/e2e",
);

/** Matches fully-literal btn-dataset test ids; template interpolations like
 *  `btn-dataset-${ds.id}` are excluded by the character class. */
const BTN_DATASET_RE = /btn-dataset-([a-z0-9][a-z0-9-]*)/g;

function collectReferencedIds(): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  for (const file of readdirSync(E2E_DIR)) {
    if (!file.endsWith(".spec.ts") && !file.endsWith(".ts")) continue;
    const content = readFileSync(resolve(E2E_DIR, file), "utf8");
    for (const match of content.matchAll(BTN_DATASET_RE)) {
      const id = match[1]!;
      const files = refs.get(id) ?? [];
      if (!files.includes(file)) files.push(file);
      refs.set(id, files);
    }
  }
  return refs;
}

describe("e2e dataset-id references stay in sync with the seeded catalog", () => {
  const catalogIds = new Set(ALL_PRESET_DATASETS.map((d) => d.id));

  it("finds at least one btn-dataset reference (regex sanity check)", () => {
    expect(collectReferencedIds().size).toBeGreaterThan(0);
  });

  it("every btn-dataset-<id> referenced by an e2e spec exists in ALL_PRESET_DATASETS", () => {
    const missing: string[] = [];
    for (const [id, files] of collectReferencedIds()) {
      if (!catalogIds.has(id)) {
        missing.push(
          `  - "${id}" (referenced by ${files.join(", ")}) is not in ALL_PRESET_DATASETS`,
        );
      }
    }
    expect(
      missing,
      [
        "e2e specs reference dataset ids that no longer exist in the seeded catalog.",
        "A catalog rename/dedup must update the specs (or vice versa):",
        ...missing,
      ].join("\n"),
    ).toEqual([]);
  });

  it("each referenced dataset's waterType preset list is non-empty (auto-load prerequisite)", () => {
    // The DatasetPanel only renders after a dataset auto-loads; auto-load only
    // happens when the active waterType's preset list is non-empty. A test
    // waiting on btn-dataset-<id> must be able to reach that state.
    for (const [id] of collectReferencedIds()) {
      const meta = ALL_PRESET_DATASETS.find((d) => d.id === id);
      if (!meta) continue; // covered by the previous assertion
      const sameType = ALL_PRESET_DATASETS.filter(
        (d) => d.waterType === meta.waterType,
      );
      expect(sameType.length, `no ${meta.waterType} presets for ${id}`).toBeGreaterThan(0);
    }
  });
});
