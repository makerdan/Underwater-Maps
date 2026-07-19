/**
 * Regression hardening for the adaptive colour palette suggestion pipeline.
 *
 * Covers:
 *   - suggestColormap edge cases: flat, empty, single unique depth value.
 *   - bandBoundaries output invariant: 11 values, strictly ascending, all integers.
 *   - Auto-apply gates: fires when colormapUserSet === false, blocked when true.
 *   - usePaletteSuggestionStore dismiss behavior.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { computeDepthProfile, suggestColormap } from "../lib/depthProfile";
import { sanitizeBandBoundaries } from "../lib/paletteStore";
import { usePaletteStore } from "../lib/paletteStore";
import { useSettingsStore } from "../lib/settingsStore";
import { usePaletteSuggestionStore } from "../hooks/usePaletteSuggestion";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function depthArray(min: number, max: number, count = 100): number[] {
  return Array.from({ length: count }, (_, i) => min + (i / (count - 1)) * (max - min));
}

/**
 * Simulate the core branching logic inside usePaletteSuggestion's useEffect.
 * Called with a depth array and a datasetId to drive the two branches under test.
 */
function runSuggestionLogic(depths: number[], datasetId = "test-dataset"): void {
  const profile = computeDepthProfile(depths);
  if (!profile) return;
  const suggestion = suggestColormap(profile);
  const { colormapUserSet, setColormapTheme } = useSettingsStore.getState();
  const { setBandBoundaries } = usePaletteStore.getState();

  if (!colormapUserSet) {
    setColormapTheme(suggestion.theme);
    setBandBoundaries(suggestion.bandBoundaries);
    usePaletteSuggestionStore.getState().clear();
  } else {
    usePaletteSuggestionStore.getState().setSuggestion(suggestion, datasetId);
  }
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore in non-browser env */ }
  usePaletteStore.getState().reset();
  useSettingsStore.getState().resetAll();
  usePaletteSuggestionStore.setState({
    suggestion: null,
    suggestionDatasetId: null,
    dismissedDatasetIds: new Set(),
  });
});

afterEach(() => {
  usePaletteStore.getState().reset();
  useSettingsStore.getState().resetAll();
  usePaletteSuggestionStore.setState({
    suggestion: null,
    suggestionDatasetId: null,
    dismissedDatasetIds: new Set(),
  });
});

// ---------------------------------------------------------------------------
// suggestColormap — edge cases not covered by depthProfile.colormap.test.ts
// ---------------------------------------------------------------------------

describe("suggestColormap — edge case inputs", () => {
  it("flat dataset (min === max) does not throw and produces valid boundaries", () => {
    const depths = new Array(20).fill(500);
    const profile = computeDepthProfile(depths);
    expect(profile).not.toBeNull();
    const result = suggestColormap(profile!);
    expect(result.theme).toMatch(/^(ocean|thermal|grayscale|viridis|freshwater|custom)$/);
    expect(sanitizeBandBoundaries(result.bandBoundaries)).not.toBeNull();
  });

  it("dataset with a single unique depth value does not produce NaN band boundaries", () => {
    const depths = new Array(50).fill(120);
    const profile = computeDepthProfile(depths);
    expect(profile).not.toBeNull();
    const { bandBoundaries } = suggestColormap(profile!);
    for (const v of bandBoundaries) {
      expect(Number.isNaN(v)).toBe(false);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("empty dataset (no vertices) returns null from computeDepthProfile — no crash", () => {
    expect(computeDepthProfile([])).toBeNull();
    expect(computeDepthProfile(new Float32Array(0))).toBeNull();
  });

  it("dataset with fewer than 4 valid values returns null — pipeline halts gracefully", () => {
    expect(computeDepthProfile([10, 20, 30])).toBeNull();
    expect(computeDepthProfile([NaN, NaN, NaN, NaN])).toBeNull();
  });

  it("all-NaN / all-negative array returns null — no crash", () => {
    expect(computeDepthProfile([-1, -2, -3, -4, -5])).toBeNull();
    const allNaN = new Array(50).fill(NaN);
    expect(computeDepthProfile(allNaN)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// bandBoundaries invariant — always 11 values, strictly ascending integers
// ---------------------------------------------------------------------------

describe("suggestColormap — bandBoundaries invariant holds for all inputs", () => {
  const cases: [string, number[]][] = [
    ["shallow freshwater (0–20 ft)", depthArray(0, 20)],
    ["narrow range (70–120 ft)", depthArray(70, 120)],
    ["ocean (0–600 ft)", depthArray(0, 600)],
    ["wide range (0–1000 ft)", depthArray(0, 1000)],
    ["full scale (0–2000 ft)", depthArray(0, 2000)],
    ["beyond scale (0–3000 ft clamped)", depthArray(0, 3000)],
    ["flat dataset", new Array(20).fill(500)],
    ["near-maximum (1990–2000 ft)", depthArray(1990, 2000)],
    ["single-metre range (99–100 ft)", depthArray(99, 100)],
  ];

  for (const [label, depths] of cases) {
    it(`${label} → 11 strictly-ascending integer values`, () => {
      const profile = computeDepthProfile(depths);
      if (!profile) return;
      const { bandBoundaries: bb } = suggestColormap(profile);

      expect(bb).toHaveLength(11);
      expect(bb[0]).toBe(0);
      expect(bb[10]).toBe(2000);

      for (const v of bb) {
        expect(Number.isInteger(v)).toBe(true);
      }

      for (let i = 1; i < bb.length; i++) {
        expect(bb[i]).toBeGreaterThan(bb[i - 1]!);
      }

      expect(sanitizeBandBoundaries(bb)).not.toBeNull();
    });
  }

  it("interior values (bb[1..9]) are never 0 or 2000", () => {
    const testDepths = [
      depthArray(0, 100),
      depthArray(0, 2000),
      depthArray(1990, 2000),
    ];
    for (const depths of testDepths) {
      const profile = computeDepthProfile(depths)!;
      const { bandBoundaries: bb } = suggestColormap(profile);
      for (let i = 1; i <= 9; i++) {
        expect(bb[i]).toBeGreaterThan(0);
        expect(bb[i]).toBeLessThan(2000);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// paletteCustomised (colormapUserSet) gates auto-apply
// ---------------------------------------------------------------------------

describe("auto-apply: colormapUserSet === false → theme and boundaries applied", () => {
  it("sets the colormap theme in settingsStore when colormapUserSet is false", () => {
    expect(useSettingsStore.getState().colormapUserSet).toBe(false);

    runSuggestionLogic(depthArray(70, 120));

    const theme = useSettingsStore.getState().colormapTheme;
    expect(theme).toBe("thermal");
  });

  it("updates bandBoundaries in paletteStore when colormapUserSet is false", () => {
    const before = [...usePaletteStore.getState().bandBoundaries];
    runSuggestionLogic(depthArray(70, 120));
    const after = usePaletteStore.getState().bandBoundaries;
    expect(after).not.toEqual(before);
    expect(sanitizeBandBoundaries(after)).not.toBeNull();
  });

  it("clears the suggestion store (no banner shown) after auto-apply", () => {
    runSuggestionLogic(depthArray(70, 120));
    expect(usePaletteSuggestionStore.getState().suggestion).toBeNull();
    expect(usePaletteSuggestionStore.getState().suggestionDatasetId).toBeNull();
  });

  it("does NOT bump colormapUserSet to true on auto-apply (setColormapTheme, not ByUser)", () => {
    runSuggestionLogic(depthArray(0, 600));
    expect(useSettingsStore.getState().colormapUserSet).toBe(false);
  });
});

describe("auto-apply: colormapUserSet === true → suggestion stored, theme unchanged", () => {
  beforeEach(() => {
    useSettingsStore.getState().setColormapThemeByUser("viridis");
    expect(useSettingsStore.getState().colormapUserSet).toBe(true);
  });

  it("does NOT change the colormap theme in settingsStore", () => {
    runSuggestionLogic(depthArray(70, 120), "dataset-abc");
    expect(useSettingsStore.getState().colormapTheme).toBe("viridis");
  });

  it("does NOT update bandBoundaries (paletteStore stays unchanged)", () => {
    const before = [...usePaletteStore.getState().bandBoundaries];
    runSuggestionLogic(depthArray(70, 120), "dataset-abc");
    expect(usePaletteStore.getState().bandBoundaries).toEqual(before);
  });

  it("stores the suggestion in usePaletteSuggestionStore", () => {
    runSuggestionLogic(depthArray(70, 120), "dataset-abc");
    const s = usePaletteSuggestionStore.getState();
    expect(s.suggestion).not.toBeNull();
    expect(s.suggestion!.theme).toBe("thermal");
    expect(s.suggestionDatasetId).toBe("dataset-abc");
  });

  it("suggestion bandBoundaries are valid (11 values, ascending integers)", () => {
    runSuggestionLogic(depthArray(0, 600), "dataset-abc");
    const s = usePaletteSuggestionStore.getState();
    expect(sanitizeBandBoundaries(s.suggestion!.bandBoundaries)).not.toBeNull();
  });

  it("switching to colormapUserSet=false on the next run auto-applies and clears", () => {
    runSuggestionLogic(depthArray(70, 120), "dataset-abc");
    expect(usePaletteSuggestionStore.getState().suggestion).not.toBeNull();

    useSettingsStore.setState({ colormapUserSet: false });
    runSuggestionLogic(depthArray(70, 120), "dataset-abc");
    expect(usePaletteSuggestionStore.getState().suggestion).toBeNull();
    expect(useSettingsStore.getState().colormapTheme).toBe("thermal");
  });
});

// ---------------------------------------------------------------------------
// usePaletteSuggestionStore — dismiss behavior
// ---------------------------------------------------------------------------

describe("usePaletteSuggestionStore dismiss behavior", () => {
  beforeEach(() => {
    useSettingsStore.getState().setColormapThemeByUser("viridis");
    runSuggestionLogic(depthArray(70, 120), "ds-1");
  });

  it("dismiss adds the current datasetId to dismissedDatasetIds", () => {
    usePaletteSuggestionStore.getState().dismiss();
    expect(usePaletteSuggestionStore.getState().isDismissed("ds-1")).toBe(true);
  });

  it("after dismiss, re-setting the same suggestion keeps banner hidden", () => {
    usePaletteSuggestionStore.getState().dismiss();

    const { suggestion } = usePaletteSuggestionStore.getState();
    usePaletteSuggestionStore.getState().setSuggestion(
      { theme: "thermal", bandBoundaries: suggestion!.bandBoundaries },
      "ds-1",
    );

    expect(usePaletteSuggestionStore.getState().isDismissed("ds-1")).toBe(true);
  });

  it("dismiss for ds-1 does NOT affect ds-2", () => {
    usePaletteSuggestionStore.getState().dismiss();
    expect(usePaletteSuggestionStore.getState().isDismissed("ds-2")).toBe(false);
  });

  it("isDismissed returns false for null datasetId", () => {
    usePaletteSuggestionStore.getState().dismiss();
    expect(usePaletteSuggestionStore.getState().isDismissed(null)).toBe(false);
  });

  it("clear() removes suggestion/datasetId but keeps dismissedDatasetIds", () => {
    usePaletteSuggestionStore.getState().dismiss();
    usePaletteSuggestionStore.getState().clear();
    const s = usePaletteSuggestionStore.getState();
    expect(s.suggestion).toBeNull();
    expect(s.suggestionDatasetId).toBeNull();
    expect(s.isDismissed("ds-1")).toBe(true);
  });

  it("a new dataset's suggestion is visible even after ds-1 is dismissed", () => {
    usePaletteSuggestionStore.getState().dismiss();

    const bb = Array.from({ length: 11 }, (_, i) =>
      i === 0 ? 0 : i === 10 ? 2000 : i * 100,
    );
    usePaletteSuggestionStore.getState().setSuggestion(
      { theme: "ocean", bandBoundaries: bb },
      "ds-2",
    );

    const s = usePaletteSuggestionStore.getState();
    expect(s.suggestionDatasetId).toBe("ds-2");
    expect(s.isDismissed("ds-2")).toBe(false);
    expect(s.isDismissed("ds-1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// suggestColormap — waterType: "freshwater" overrides depth-based heuristics
// ---------------------------------------------------------------------------

describe("suggestColormap — freshwater waterType override", () => {
  it("moderate-depth freshwater profile (0–60 ft) gets freshwater theme, not thermal", () => {
    const profile = computeDepthProfile(depthArray(0, 60));
    expect(profile).not.toBeNull();
    const { theme } = suggestColormap(profile!, "freshwater");
    expect(theme).toBe("freshwater");
  });

  it("deeper freshwater profile (0–47 ft, Ray Roberts range) gets freshwater theme", () => {
    const profile = computeDepthProfile(depthArray(0, 47));
    expect(profile).not.toBeNull();
    const { theme } = suggestColormap(profile!, "freshwater");
    expect(theme).toBe("freshwater");
  });

  it("wide freshwater profile (0–200 ft) gets freshwater theme, not ocean or grayscale", () => {
    const profile = computeDepthProfile(depthArray(0, 200));
    expect(profile).not.toBeNull();
    const { theme } = suggestColormap(profile!, "freshwater");
    expect(theme).toBe("freshwater");
  });

  it("same moderate-depth profile WITHOUT waterType gets thermal (depth branch fires)", () => {
    const profile = computeDepthProfile(depthArray(0, 60));
    expect(profile).not.toBeNull();
    const { theme } = suggestColormap(profile!);
    expect(theme).toBe("thermal");
  });

  it("saltwater waterType does NOT force freshwater theme", () => {
    const profile = computeDepthProfile(depthArray(0, 60));
    expect(profile).not.toBeNull();
    const { theme } = suggestColormap(profile!, "saltwater");
    expect(theme).not.toBe("freshwater");
  });

  it("freshwater bandBoundaries are still valid (11 values, strictly ascending integers)", () => {
    const profile = computeDepthProfile(depthArray(0, 47))!;
    const { bandBoundaries: bb } = suggestColormap(profile, "freshwater");
    expect(bb).toHaveLength(11);
    expect(bb[0]).toBe(0);
    expect(bb[10]).toBe(2000);
    for (const v of bb) {
      expect(Number.isInteger(v)).toBe(true);
    }
    for (let i = 1; i < bb.length; i++) {
      expect(bb[i]).toBeGreaterThan(bb[i - 1]!);
    }
    expect(sanitizeBandBoundaries(bb)).not.toBeNull();
  });

  it("auto-apply with waterType freshwater sets colormapTheme to freshwater in settingsStore", () => {
    expect(useSettingsStore.getState().colormapUserSet).toBe(false);

    const profile = computeDepthProfile(depthArray(0, 47))!;
    const suggestion = suggestColormap(profile, "freshwater");
    const { setColormapTheme } = useSettingsStore.getState();
    const { setBandBoundaries } = usePaletteStore.getState();
    setColormapTheme(suggestion.theme);
    setBandBoundaries(suggestion.bandBoundaries);

    expect(useSettingsStore.getState().colormapTheme).toBe("freshwater");
  });
});
