import { describe, it, expect } from "vitest";
import {
  PostMarkersBody,
  postMarkersBodyLabelMax,
  postMarkersBodyNotesMax,
  PatchMarkersIdBody,
  patchMarkersIdBodyLabelMax,
  patchMarkersIdBodyNotesMax,
  GetMarkersQueryParams,
  PutSettingsBody,
  putSettingsBodyZonePaintBrushRadiusMax,
  putSettingsBodyZonePaintSlotMin,
  putSettingsBodyZonePaintSlotMax,
  GetSettingsResponse,
  getSettingsResponseZonePaintBrushRadiusMax,
  getSettingsResponseZonePaintSlotMin,
  getSettingsResponseZonePaintSlotMax,
  PostNceiSaveBody,
  PostDatasetsBboxQueryBody,
  PostTrailsBody,
  DeepHealthCheckResponse,
} from "../index.js";

// ---------------------------------------------------------------------------
// PostMarkersBody
// ---------------------------------------------------------------------------

describe("PostMarkersBody", () => {
  const valid = {
    datasetId: "ds-1",
    lon: -136.0,
    lat: 58.5,
    depth: 50,
    label: "Test Marker",
  };

  it("accepts a valid body", () => {
    expect(PostMarkersBody.safeParse(valid).success).toBe(true);
  });

  it("rejects when datasetId is missing", () => {
    const { datasetId: _omit, ...rest } = valid;
    expect(PostMarkersBody.safeParse(rest).success).toBe(false);
  });

  it("rejects when lon is a string (wrong type)", () => {
    expect(PostMarkersBody.safeParse({ ...valid, lon: "not-a-number" }).success).toBe(false);
  });

  it("rejects when label is missing", () => {
    const { label: _omit, ...rest } = valid;
    expect(PostMarkersBody.safeParse(rest).success).toBe(false);
  });

  it("rejects when label is empty string", () => {
    expect(PostMarkersBody.safeParse({ ...valid, label: "" }).success).toBe(false);
  });

  it(`accepts a label at exactly ${postMarkersBodyLabelMax} characters`, () => {
    expect(PostMarkersBody.safeParse({ ...valid, label: "a".repeat(postMarkersBodyLabelMax) }).success).toBe(true);
  });

  it(`rejects a label at ${postMarkersBodyLabelMax + 1} characters`, () => {
    expect(PostMarkersBody.safeParse({ ...valid, label: "a".repeat(postMarkersBodyLabelMax + 1) }).success).toBe(false);
  });

  it(`accepts notes at exactly ${postMarkersBodyNotesMax} characters`, () => {
    expect(PostMarkersBody.safeParse({ ...valid, notes: "n".repeat(postMarkersBodyNotesMax) }).success).toBe(true);
  });

  it(`rejects notes at ${postMarkersBodyNotesMax + 1} characters`, () => {
    expect(PostMarkersBody.safeParse({ ...valid, notes: "n".repeat(postMarkersBodyNotesMax + 1) }).success).toBe(false);
  });

  it("accepts null notes", () => {
    expect(PostMarkersBody.safeParse({ ...valid, notes: null }).success).toBe(true);
  });

  it("rejects an invalid type enum value", () => {
    expect(PostMarkersBody.safeParse({ ...valid, type: "dolphin" }).success).toBe(false);
  });

  it("accepts a valid type enum value", () => {
    expect(PostMarkersBody.safeParse({ ...valid, type: "fish" }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PatchMarkersIdBody
// ---------------------------------------------------------------------------

describe("PatchMarkersIdBody", () => {
  it("accepts an empty body (all fields optional)", () => {
    expect(PatchMarkersIdBody.safeParse({}).success).toBe(true);
  });

  it("accepts a valid partial body with label only", () => {
    expect(PatchMarkersIdBody.safeParse({ label: "Updated" }).success).toBe(true);
  });

  it(`rejects label longer than ${patchMarkersIdBodyLabelMax} characters`, () => {
    expect(PatchMarkersIdBody.safeParse({ label: "a".repeat(patchMarkersIdBodyLabelMax + 1) }).success).toBe(false);
  });

  it(`accepts label at exactly ${patchMarkersIdBodyLabelMax} characters`, () => {
    expect(PatchMarkersIdBody.safeParse({ label: "a".repeat(patchMarkersIdBodyLabelMax) }).success).toBe(true);
  });

  it("rejects empty label (min 1)", () => {
    expect(PatchMarkersIdBody.safeParse({ label: "" }).success).toBe(false);
  });

  it(`rejects notes longer than ${patchMarkersIdBodyNotesMax} characters`, () => {
    expect(PatchMarkersIdBody.safeParse({ notes: "n".repeat(patchMarkersIdBodyNotesMax + 1) }).success).toBe(false);
  });

  it(`accepts notes at exactly ${patchMarkersIdBodyNotesMax} characters`, () => {
    expect(PatchMarkersIdBody.safeParse({ notes: "n".repeat(patchMarkersIdBodyNotesMax) }).success).toBe(true);
  });

  it("rejects an invalid type enum value", () => {
    expect(PatchMarkersIdBody.safeParse({ type: "unicorn" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GetMarkersQueryParams
// ---------------------------------------------------------------------------

describe("GetMarkersQueryParams", () => {
  it("accepts a valid datasetId", () => {
    expect(GetMarkersQueryParams.safeParse({ datasetId: "glba-main" }).success).toBe(true);
  });

  it("coerces a numeric datasetId to string", () => {
    const r = GetMarkersQueryParams.safeParse({ datasetId: 42 });
    expect(r.success).toBe(true);
    if (r.success) expect(typeof r.data.datasetId).toBe("string");
  });

  it("coerces undefined datasetId to the string 'undefined' (coerce.string behaviour)", () => {
    const r = GetMarkersQueryParams.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.datasetId).toBe("undefined");
  });
});

// ---------------------------------------------------------------------------
// PutSettingsBody
// ---------------------------------------------------------------------------

describe("PutSettingsBody", () => {
  it("accepts an empty body (all fields have defaults)", () => {
    expect(PutSettingsBody.safeParse({}).success).toBe(true);
  });

  it("accepts a partial body with just textureQuality", () => {
    expect(PutSettingsBody.safeParse({ textureQuality: "low" }).success).toBe(true);
  });

  it("rejects an invalid textureQuality enum value", () => {
    expect(PutSettingsBody.safeParse({ textureQuality: "ultra" }).success).toBe(false);
  });

  it("rejects fogDensity as a string (wrong type)", () => {
    expect(PutSettingsBody.safeParse({ fogDensity: "dense" }).success).toBe(false);
  });

  it("rejects fogDensity out of range (too high)", () => {
    expect(PutSettingsBody.safeParse({ fogDensity: 1.0 }).success).toBe(false);
  });

  it("rejects fogDensity out of range (too low)", () => {
    expect(PutSettingsBody.safeParse({ fogDensity: 0.001 }).success).toBe(false);
  });

  it("rejects an invalid colormapTheme enum value", () => {
    expect(PutSettingsBody.safeParse({ colormapTheme: "neon" }).success).toBe(false);
  });

  it("accepts valid colormapTheme values", () => {
    for (const theme of ["ocean", "thermal", "grayscale", "viridis", "freshwater", "custom"] as const) {
      expect(PutSettingsBody.safeParse({ colormapTheme: theme }).success).toBe(true);
    }
  });

  it("accepts a valid waterType value", () => {
    expect(PutSettingsBody.safeParse({ waterType: "freshwater" }).success).toBe(true);
  });

  it("rejects an invalid waterType enum value", () => {
    expect(PutSettingsBody.safeParse({ waterType: "brackish" }).success).toBe(false);
  });

  it("rejects bandBoundaries that don't start with 0", () => {
    const bad = [1, 50, 100, 150, 200, 250, 300, 350, 450, 600, 2000];
    expect(PutSettingsBody.safeParse({ bandBoundaries: bad }).success).toBe(false);
  });

  it("rejects bandBoundaries that don't end with 2000", () => {
    const bad = [0, 50, 100, 150, 200, 250, 300, 350, 450, 600, 1999];
    expect(PutSettingsBody.safeParse({ bandBoundaries: bad }).success).toBe(false);
  });

  it("rejects non-strictly-increasing bandBoundaries", () => {
    const bad = [0, 50, 50, 150, 200, 250, 300, 350, 450, 600, 2000];
    expect(PutSettingsBody.safeParse({ bandBoundaries: bad }).success).toBe(false);
  });

  it("accepts valid bandBoundaries", () => {
    const good = [0, 50, 100, 150, 200, 250, 300, 350, 450, 600, 2000];
    expect(PutSettingsBody.safeParse({ bandBoundaries: good }).success).toBe(true);
  });

  it("accepts valid currentDepthLayers values", () => {
    for (const layer of ["surface", "mid", "near-bottom"] as const) {
      expect(PutSettingsBody.safeParse({ currentDepthLayers: [layer] }).success).toBe(true);
    }
  });

  it("accepts multiple currentDepthLayers values together", () => {
    expect(PutSettingsBody.safeParse({ currentDepthLayers: ["surface", "mid", "near-bottom"] }).success).toBe(true);
  });

  it("rejects an invalid currentDepthLayers enum value", () => {
    expect(PutSettingsBody.safeParse({ currentDepthLayers: ["deep"] }).success).toBe(false);
  });

  it("accepts zonePaintBrushRadius at minimum (1)", () => {
    expect(PutSettingsBody.safeParse({ zonePaintBrushRadius: 1 }).success).toBe(true);
  });

  it(`accepts zonePaintBrushRadius at maximum (${putSettingsBodyZonePaintBrushRadiusMax})`, () => {
    expect(PutSettingsBody.safeParse({ zonePaintBrushRadius: putSettingsBodyZonePaintBrushRadiusMax }).success).toBe(true);
  });

  it(`rejects zonePaintBrushRadius above maximum (${putSettingsBodyZonePaintBrushRadiusMax + 1})`, () => {
    expect(PutSettingsBody.safeParse({ zonePaintBrushRadius: putSettingsBodyZonePaintBrushRadiusMax + 1 }).success).toBe(false);
  });

  it("rejects zonePaintBrushRadius below minimum (0)", () => {
    expect(PutSettingsBody.safeParse({ zonePaintBrushRadius: 0 }).success).toBe(false);
  });

  it("rejects zonePaintBrushRadius as a float", () => {
    expect(PutSettingsBody.safeParse({ zonePaintBrushRadius: 3.5 }).success).toBe(false);
  });

  it(`accepts zonePaintSlot at minimum (${putSettingsBodyZonePaintSlotMin})`, () => {
    expect(PutSettingsBody.safeParse({ zonePaintSlot: putSettingsBodyZonePaintSlotMin }).success).toBe(true);
  });

  it(`accepts zonePaintSlot at maximum (${putSettingsBodyZonePaintSlotMax})`, () => {
    expect(PutSettingsBody.safeParse({ zonePaintSlot: putSettingsBodyZonePaintSlotMax }).success).toBe(true);
  });

  it(`rejects zonePaintSlot above maximum (${putSettingsBodyZonePaintSlotMax + 1})`, () => {
    expect(PutSettingsBody.safeParse({ zonePaintSlot: putSettingsBodyZonePaintSlotMax + 1 }).success).toBe(false);
  });

  it("rejects zonePaintSlot below minimum (-1)", () => {
    expect(PutSettingsBody.safeParse({ zonePaintSlot: -1 }).success).toBe(false);
  });

  it("rejects zonePaintSlot as a float", () => {
    expect(PutSettingsBody.safeParse({ zonePaintSlot: 1.5 }).success).toBe(false);
  });

  it("accepts valid globalFontSize values", () => {
    for (const size of ["smallest", "small", "medium", "large", "x-large", "largest"] as const) {
      expect(PutSettingsBody.safeParse({ globalFontSize: size }).success).toBe(true);
    }
  });

  it("rejects an invalid globalFontSize enum value", () => {
    expect(PutSettingsBody.safeParse({ globalFontSize: "huge" }).success).toBe(false);
  });

  it("accepts valid intertidalScoreMode values", () => {
    for (const mode of ["tidepool", "beachcombing"] as const) {
      expect(PutSettingsBody.safeParse({ intertidalScoreMode: mode }).success).toBe(true);
    }
  });

  it("rejects an invalid intertidalScoreMode enum value", () => {
    expect(PutSettingsBody.safeParse({ intertidalScoreMode: "rocky-shore" }).success).toBe(false);
  });

  it("accepts boolean overlay toggles set to true", () => {
    const toggles = {
      asosOverlayActive: true,
      rawsOverlayActive: true,
      windOverlayActive: true,
      tideOverlayActive: true,
      currentOverlayActive: true,
      sidePaneCollapsed: true,
      zoneOverlayEnabled: true,
      zonePaintMode: true,
      substrateColorMode: true,
      intertidalHotspotsEnabled: true,
      efhOverlayEnabled: true,
    };
    expect(PutSettingsBody.safeParse(toggles).success).toBe(true);
  });

  it("rejects a non-boolean value for windOverlayActive", () => {
    expect(PutSettingsBody.safeParse({ windOverlayActive: "yes" }).success).toBe(false);
  });

  it("accepts hiddenSubstrateClasses as an array of strings", () => {
    expect(PutSettingsBody.safeParse({ hiddenSubstrateClasses: ["rock", "sand"] }).success).toBe(true);
  });

  it("accepts hiddenSubstrateClasses as an empty array", () => {
    expect(PutSettingsBody.safeParse({ hiddenSubstrateClasses: [] }).success).toBe(true);
  });

  it("rejects hiddenSubstrateClasses containing non-string items", () => {
    expect(PutSettingsBody.safeParse({ hiddenSubstrateClasses: [1, 2] }).success).toBe(false);
  });

  it("accepts hiddenEfhSpecies as an array of strings", () => {
    expect(PutSettingsBody.safeParse({ hiddenEfhSpecies: ["rockfish", "halibut"] }).success).toBe(true);
  });

  it("accepts hiddenEfhSpecies as an empty array", () => {
    expect(PutSettingsBody.safeParse({ hiddenEfhSpecies: [] }).success).toBe(true);
  });

  it("rejects hiddenEfhSpecies containing non-string items", () => {
    expect(PutSettingsBody.safeParse({ hiddenEfhSpecies: [null] }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GetSettingsResponse
// ---------------------------------------------------------------------------

describe("GetSettingsResponse", () => {
  it("accepts an empty body (all fields have defaults)", () => {
    expect(GetSettingsResponse.safeParse({}).success).toBe(true);
  });

  it("rejects an invalid particleDensity enum value", () => {
    expect(GetSettingsResponse.safeParse({ particleDensity: "thick" }).success).toBe(false);
  });

  it("accepts valid particleDensity values", () => {
    for (const v of ["off", "sparse", "dense"] as const) {
      expect(GetSettingsResponse.safeParse({ particleDensity: v }).success).toBe(true);
    }
  });

  it("rejects an invalid coordinateFormat enum value", () => {
    expect(GetSettingsResponse.safeParse({ coordinateFormat: "utm" }).success).toBe(false);
  });

  it("accepts valid currentDepthLayers values", () => {
    for (const layer of ["surface", "mid", "near-bottom"] as const) {
      expect(GetSettingsResponse.safeParse({ currentDepthLayers: [layer] }).success).toBe(true);
    }
  });

  it("accepts multiple currentDepthLayers values together", () => {
    expect(GetSettingsResponse.safeParse({ currentDepthLayers: ["surface", "near-bottom"] }).success).toBe(true);
  });

  it("rejects an invalid currentDepthLayers enum value", () => {
    expect(GetSettingsResponse.safeParse({ currentDepthLayers: ["bottom"] }).success).toBe(false);
  });

  it("accepts zonePaintBrushRadius at minimum (1)", () => {
    expect(GetSettingsResponse.safeParse({ zonePaintBrushRadius: 1 }).success).toBe(true);
  });

  it(`accepts zonePaintBrushRadius at maximum (${getSettingsResponseZonePaintBrushRadiusMax})`, () => {
    expect(GetSettingsResponse.safeParse({ zonePaintBrushRadius: getSettingsResponseZonePaintBrushRadiusMax }).success).toBe(true);
  });

  it(`rejects zonePaintBrushRadius above maximum (${getSettingsResponseZonePaintBrushRadiusMax + 1})`, () => {
    expect(GetSettingsResponse.safeParse({ zonePaintBrushRadius: getSettingsResponseZonePaintBrushRadiusMax + 1 }).success).toBe(false);
  });

  it("rejects zonePaintBrushRadius below minimum (0)", () => {
    expect(GetSettingsResponse.safeParse({ zonePaintBrushRadius: 0 }).success).toBe(false);
  });

  it("rejects zonePaintBrushRadius as a float", () => {
    expect(GetSettingsResponse.safeParse({ zonePaintBrushRadius: 2.7 }).success).toBe(false);
  });

  it(`accepts zonePaintSlot at minimum (${getSettingsResponseZonePaintSlotMin})`, () => {
    expect(GetSettingsResponse.safeParse({ zonePaintSlot: getSettingsResponseZonePaintSlotMin }).success).toBe(true);
  });

  it(`accepts zonePaintSlot at maximum (${getSettingsResponseZonePaintSlotMax})`, () => {
    expect(GetSettingsResponse.safeParse({ zonePaintSlot: getSettingsResponseZonePaintSlotMax }).success).toBe(true);
  });

  it(`rejects zonePaintSlot above maximum (${getSettingsResponseZonePaintSlotMax + 1})`, () => {
    expect(GetSettingsResponse.safeParse({ zonePaintSlot: getSettingsResponseZonePaintSlotMax + 1 }).success).toBe(false);
  });

  it("rejects zonePaintSlot below minimum (-1)", () => {
    expect(GetSettingsResponse.safeParse({ zonePaintSlot: -1 }).success).toBe(false);
  });

  it("rejects zonePaintSlot as a float", () => {
    expect(GetSettingsResponse.safeParse({ zonePaintSlot: 0.5 }).success).toBe(false);
  });

  it("accepts valid globalFontSize values", () => {
    for (const size of ["smallest", "small", "medium", "large", "x-large", "largest"] as const) {
      expect(GetSettingsResponse.safeParse({ globalFontSize: size }).success).toBe(true);
    }
  });

  it("rejects an invalid globalFontSize enum value", () => {
    expect(GetSettingsResponse.safeParse({ globalFontSize: "gigantic" }).success).toBe(false);
  });

  it("accepts valid intertidalScoreMode values", () => {
    for (const mode of ["tidepool", "beachcombing"] as const) {
      expect(GetSettingsResponse.safeParse({ intertidalScoreMode: mode }).success).toBe(true);
    }
  });

  it("rejects an invalid intertidalScoreMode enum value", () => {
    expect(GetSettingsResponse.safeParse({ intertidalScoreMode: "cliffside" }).success).toBe(false);
  });

  it("accepts boolean overlay toggles set to true", () => {
    const toggles = {
      asosOverlayActive: true,
      rawsOverlayActive: true,
      windOverlayActive: true,
      tideOverlayActive: true,
      currentOverlayActive: true,
      sidePaneCollapsed: true,
      zoneOverlayEnabled: true,
      zonePaintMode: true,
      substrateColorMode: true,
      intertidalHotspotsEnabled: true,
      efhOverlayEnabled: true,
    };
    expect(GetSettingsResponse.safeParse(toggles).success).toBe(true);
  });

  it("rejects a non-boolean value for tideOverlayActive", () => {
    expect(GetSettingsResponse.safeParse({ tideOverlayActive: 1 }).success).toBe(false);
  });

  it("accepts hiddenSubstrateClasses as an array of strings", () => {
    expect(GetSettingsResponse.safeParse({ hiddenSubstrateClasses: ["mud", "gravel"] }).success).toBe(true);
  });

  it("accepts hiddenSubstrateClasses as an empty array", () => {
    expect(GetSettingsResponse.safeParse({ hiddenSubstrateClasses: [] }).success).toBe(true);
  });

  it("rejects hiddenSubstrateClasses containing non-string items", () => {
    expect(GetSettingsResponse.safeParse({ hiddenSubstrateClasses: [42] }).success).toBe(false);
  });

  it("accepts hiddenEfhSpecies as an array of strings", () => {
    expect(GetSettingsResponse.safeParse({ hiddenEfhSpecies: ["salmon", "crab"] }).success).toBe(true);
  });

  it("accepts hiddenEfhSpecies as an empty array", () => {
    expect(GetSettingsResponse.safeParse({ hiddenEfhSpecies: [] }).success).toBe(true);
  });

  it("rejects hiddenEfhSpecies containing non-string items", () => {
    expect(GetSettingsResponse.safeParse({ hiddenEfhSpecies: [false] }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PostNceiSaveBody (NceiSaveBodySchema)
// ---------------------------------------------------------------------------

describe("PostNceiSaveBody", () => {
  const validResult = {
    id: "gov.noaa.ngdc.mgg.dem:703",
    name: "NCEI Multibeam Survey",
    sourceAgency: "NOAA/NCEI",
    coverageBbox: { minLon: -136.0, minLat: 57.0, maxLon: -130.0, maxLat: 60.0 },
    wcsAvailable: true,
  };

  it("accepts a valid body", () => {
    expect(PostNceiSaveBody.safeParse({ result: validResult }).success).toBe(true);
  });

  it("rejects when result is missing", () => {
    expect(PostNceiSaveBody.safeParse({}).success).toBe(false);
  });

  it("rejects when result.id is missing", () => {
    const { id: _omit, ...rest } = validResult;
    expect(PostNceiSaveBody.safeParse({ result: rest }).success).toBe(false);
  });

  it("rejects when result.coverageBbox is missing", () => {
    const { coverageBbox: _omit, ...rest } = validResult;
    expect(PostNceiSaveBody.safeParse({ result: rest }).success).toBe(false);
  });

  it("rejects when wcsAvailable is not a boolean", () => {
    expect(PostNceiSaveBody.safeParse({ result: { ...validResult, wcsAvailable: "yes" } }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PostDatasetsBboxQueryBody (BboxQueryBody)
// ---------------------------------------------------------------------------

describe("PostDatasetsBboxQueryBody", () => {
  const valid = { north: 60.0, south: 57.0, east: -130.0, west: -136.0 };

  it("accepts a valid body", () => {
    expect(PostDatasetsBboxQueryBody.safeParse(valid).success).toBe(true);
  });

  it("rejects when north is missing", () => {
    const { north: _omit, ...rest } = valid;
    expect(PostDatasetsBboxQueryBody.safeParse(rest).success).toBe(false);
  });

  it("rejects when south is missing", () => {
    const { south: _omit, ...rest } = valid;
    expect(PostDatasetsBboxQueryBody.safeParse(rest).success).toBe(false);
  });

  it("rejects north as a string (wrong type)", () => {
    expect(PostDatasetsBboxQueryBody.safeParse({ ...valid, north: "high" }).success).toBe(false);
  });

  it("rejects when Infinity is provided for north", () => {
    expect(PostDatasetsBboxQueryBody.safeParse({ ...valid, north: Infinity }).success).toBe(false);
  });

  it("rejects when NaN is provided for south", () => {
    expect(PostDatasetsBboxQueryBody.safeParse({ ...valid, south: NaN }).success).toBe(false);
  });

  it("rejects when west is Infinity", () => {
    expect(PostDatasetsBboxQueryBody.safeParse({ ...valid, west: Infinity }).success).toBe(false);
  });

  it("rejects an invalid dataType enum value", () => {
    expect(PostDatasetsBboxQueryBody.safeParse({ ...valid, dataType: "treasure" }).success).toBe(false);
  });

  it("accepts optional dataType enum values", () => {
    for (const dt of ["bathymetry", "substrate", "habitat", "lidar", "chart"] as const) {
      expect(PostDatasetsBboxQueryBody.safeParse({ ...valid, dataType: dt }).success).toBe(true);
    }
  });

  it("accepts optional waterType enum values", () => {
    expect(PostDatasetsBboxQueryBody.safeParse({ ...valid, waterType: "saltwater" }).success).toBe(true);
    expect(PostDatasetsBboxQueryBody.safeParse({ ...valid, waterType: "freshwater" }).success).toBe(true);
  });

  it("rejects an invalid waterType enum value", () => {
    expect(PostDatasetsBboxQueryBody.safeParse({ ...valid, waterType: "brackish" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PostTrailsBody
// ---------------------------------------------------------------------------

describe("PostTrailsBody", () => {
  const validPoint = { lon: -136.0, lat: 58.0, timestamp: 1700000000000 };
  const valid = {
    datasetId: "ds-1",
    name: "Morning Drift",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    points: [validPoint, { ...validPoint, lon: -135.9, timestamp: 1700000001000 }],
  };

  it("accepts a valid body", () => {
    expect(PostTrailsBody.safeParse(valid).success).toBe(true);
  });

  it("rejects when datasetId is missing", () => {
    const { datasetId: _omit, ...rest } = valid;
    expect(PostTrailsBody.safeParse(rest).success).toBe(false);
  });

  it("rejects when name is missing", () => {
    const { name: _omit, ...rest } = valid;
    expect(PostTrailsBody.safeParse(rest).success).toBe(false);
  });

  it("rejects when startedAt is not a date-like value", () => {
    expect(PostTrailsBody.safeParse({ ...valid, startedAt: "not-a-date" }).success).toBe(false);
  });

  it("rejects when points is missing", () => {
    const { points: _omit, ...rest } = valid;
    expect(PostTrailsBody.safeParse(rest).success).toBe(false);
  });

  it("rejects when a point is missing lon", () => {
    const badPoint = { lat: 58.0, timestamp: 1700000000000 };
    expect(PostTrailsBody.safeParse({ ...valid, points: [badPoint] }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DeepHealthCheckResponse
// ---------------------------------------------------------------------------

describe("DeepHealthCheckResponse", () => {
  const valid = {
    status: "ok",
    subsystems: {
      db: { status: "ok" },
      poe: { status: "ok" },
      aoos: { status: "ok" },
    },
  };

  it("accepts a valid response", () => {
    expect(DeepHealthCheckResponse.safeParse(valid).success).toBe(true);
  });

  it("accepts a degraded response with optional fields", () => {
    expect(
      DeepHealthCheckResponse.safeParse({
        status: "degraded",
        subsystems: {
          db: { status: "ok", latencyMs: 5 },
          poe: { status: "degraded", error: "timeout" },
          aoos: { status: "ok" },
        },
      }).success,
    ).toBe(true);
  });

  it("rejects when status is an invalid enum value", () => {
    expect(DeepHealthCheckResponse.safeParse({ ...valid, status: "error" }).success).toBe(false);
  });

  it("rejects when a subsystem is missing", () => {
    expect(
      DeepHealthCheckResponse.safeParse({
        status: "ok",
        subsystems: { db: { status: "ok" }, poe: { status: "ok" } },
      }).success,
    ).toBe(false);
  });

  it("rejects when a subsystem status is an invalid enum value", () => {
    expect(
      DeepHealthCheckResponse.safeParse({
        ...valid,
        subsystems: { ...valid.subsystems, db: { status: "unknown" } },
      }).success,
    ).toBe(false);
  });
});
