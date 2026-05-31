/**
 * Unit tests for the intertidal hotspot pin-building logic.
 *
 * Coverage:
 *   1. mode=tidepool → pins get teal color (#0d9488) and tidepoolScore as
 *      the active score.
 *   2. mode=beachcombing → pins get amber color (#d97706) and beachcombingScore
 *      as the active score.
 *   3. Features whose active-mode score is < 1 are filtered out.
 *   4. Features with no valid geometry outer ring are filtered out.
 *   5. MultiPolygon features are handled — centroid computed from first ring.
 *   6. unitId falls back to a lon/lat string when the property is absent.
 *   7. The SelectedHotspot in dataMap carries both mode signals (whySummary,
 *      bioband, debris, energy, humanUse) and correct tidepoolScore /
 *      beachcombingScore regardless of which mode built the pins.
 *   8. Clicking a pin delegates the correct full SelectedHotspot — verified
 *      by looking up the unitId in the returned dataMap.
 */
import { describe, it, expect } from "vitest";
import {
  buildIntertidalHotspotDescriptors,
  type IntertidalSpotFeature,
} from "@/lib/overviewRenderer";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const POLYGON_COORDS = [
  [-132.4, 56.0],
  [-132.3, 56.0],
  [-132.3, 56.1],
  [-132.4, 56.1],
  [-132.4, 56.0],
];

function makeFeature(overrides: {
  unitId?: string;
  tidepoolScore?: number;
  beachcombingScore?: number;
  shoreZoneClass?: string;
  substrate?: string;
  scoreSignals?: IntertidalSpotFeature["properties"]["scoreSignals"];
  geometryType?: "Polygon" | "MultiPolygon" | "none";
}): IntertidalSpotFeature {
  const {
    unitId = "unit-001",
    tidepoolScore = 78,
    beachcombingScore = 45,
    shoreZoneClass = "B1a",
    substrate = "bedrock",
    scoreSignals,
    geometryType = "Polygon",
  } = overrides;

  let geometry: IntertidalSpotFeature["geometry"];
  if (geometryType === "Polygon") {
    geometry = { type: "Polygon", coordinates: [POLYGON_COORDS] };
  } else if (geometryType === "MultiPolygon") {
    geometry = { type: "MultiPolygon", coordinates: [[POLYGON_COORDS]] };
  } else {
    geometry = { type: "Point", coordinates: [] };
  }

  return {
    geometry,
    properties: {
      unitId,
      tidepoolScore,
      beachcombingScore,
      shoreZoneClass,
      substrate,
      scoreSignals: scoreSignals ?? {
        tidepool: {
          substrate: "Bedrock tidepool",
          bioband: "Barnacle zone",
          debris: null,
          energy: "High",
          humanUse: null,
          whySummary: "High biodiversity tidepool habitat",
        },
        beachcombing: {
          substrate: "Sandy beach",
          bioband: null,
          debris: "Drift log",
          energy: "Low",
          humanUse: "Recreational",
          whySummary: "Good beachcombing conditions",
        },
      },
    },
  };
}

const SOURCE = "NOAA ShoreZone / AOOS";
const CREDIT = "https://portal.aoos.org/";

// ---------------------------------------------------------------------------
// Tests — pin color and score per mode
// ---------------------------------------------------------------------------

describe("buildIntertidalHotspotDescriptors — pin color and score", () => {
  it("tidepool mode → pin color is teal (#0d9488)", () => {
    const { pins } = buildIntertidalHotspotDescriptors(
      [makeFeature({ tidepoolScore: 78, beachcombingScore: 45 })],
      "tidepool",
      SOURCE,
      CREDIT,
    );
    expect(pins).toHaveLength(1);
    expect(pins[0].color).toBe("#0d9488");
  });

  it("tidepool mode → pin score equals tidepoolScore", () => {
    const { pins } = buildIntertidalHotspotDescriptors(
      [makeFeature({ tidepoolScore: 78, beachcombingScore: 45 })],
      "tidepool",
      SOURCE,
      CREDIT,
    );
    expect(pins[0].score).toBe(78);
  });

  it("beachcombing mode → pin color is amber (#d97706)", () => {
    const { pins } = buildIntertidalHotspotDescriptors(
      [makeFeature({ tidepoolScore: 78, beachcombingScore: 45 })],
      "beachcombing",
      SOURCE,
      CREDIT,
    );
    expect(pins).toHaveLength(1);
    expect(pins[0].color).toBe("#d97706");
  });

  it("beachcombing mode → pin score equals beachcombingScore", () => {
    const { pins } = buildIntertidalHotspotDescriptors(
      [makeFeature({ tidepoolScore: 78, beachcombingScore: 45 })],
      "beachcombing",
      SOURCE,
      CREDIT,
    );
    expect(pins[0].score).toBe(45);
  });
});

// ---------------------------------------------------------------------------
// Tests — filtering
// ---------------------------------------------------------------------------

describe("buildIntertidalHotspotDescriptors — filtering", () => {
  it("filters out features whose active-mode score is < 1 (tidepool mode)", () => {
    const features = [
      makeFeature({ tidepoolScore: 0, beachcombingScore: 60 }),
      makeFeature({ unitId: "unit-002", tidepoolScore: 50, beachcombingScore: 30 }),
    ];
    const { pins } = buildIntertidalHotspotDescriptors(
      features,
      "tidepool",
      SOURCE,
      CREDIT,
    );
    expect(pins).toHaveLength(1);
    expect(pins[0].unitId).toBe("unit-002");
  });

  it("filters out features whose active-mode score is < 1 (beachcombing mode)", () => {
    const features = [
      makeFeature({ tidepoolScore: 80, beachcombingScore: 0 }),
      makeFeature({ unitId: "unit-002", tidepoolScore: 30, beachcombingScore: 55 }),
    ];
    const { pins } = buildIntertidalHotspotDescriptors(
      features,
      "beachcombing",
      SOURCE,
      CREDIT,
    );
    expect(pins).toHaveLength(1);
    expect(pins[0].unitId).toBe("unit-002");
  });

  it("filters out features with no valid outer ring geometry", () => {
    const { pins } = buildIntertidalHotspotDescriptors(
      [makeFeature({ geometryType: "none" })],
      "tidepool",
      SOURCE,
      CREDIT,
    );
    expect(pins).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — geometry variants
// ---------------------------------------------------------------------------

describe("buildIntertidalHotspotDescriptors — geometry variants", () => {
  it("handles MultiPolygon geometry and computes a valid centroid", () => {
    const { pins } = buildIntertidalHotspotDescriptors(
      [makeFeature({ geometryType: "MultiPolygon" })],
      "tidepool",
      SOURCE,
      CREDIT,
    );
    expect(pins).toHaveLength(1);
    expect(typeof pins[0].lon).toBe("number");
    expect(typeof pins[0].lat).toBe("number");
  });

  it("uses provided unitId as pin identifier", () => {
    const { pins } = buildIntertidalHotspotDescriptors(
      [makeFeature({ unitId: "custom-unit-99" })],
      "tidepool",
      SOURCE,
      CREDIT,
    );
    expect(pins[0].unitId).toBe("custom-unit-99");
  });

  it("generates unitId from lon/lat when property is missing", () => {
    const feature = makeFeature({});
    delete (feature.properties as { unitId?: string }).unitId;

    const { pins } = buildIntertidalHotspotDescriptors(
      [feature],
      "tidepool",
      SOURCE,
      CREDIT,
    );
    expect(pins).toHaveLength(1);
    expect(pins[0].unitId).toMatch(/^-?\d+\.\d+_\d+\.\d+$/);
  });
});

// ---------------------------------------------------------------------------
// Tests — SelectedHotspot object (what setSelectedHotspot receives on click)
// ---------------------------------------------------------------------------

describe("buildIntertidalHotspotDescriptors — SelectedHotspot in dataMap", () => {
  it("dataMap contains the expected unitId key", () => {
    const { dataMap } = buildIntertidalHotspotDescriptors(
      [makeFeature({ unitId: "unit-001" })],
      "tidepool",
      SOURCE,
      CREDIT,
    );
    expect(dataMap.has("unit-001")).toBe(true);
  });

  it("hotspot carries both tidepoolScore and beachcombingScore regardless of mode", () => {
    const { dataMap } = buildIntertidalHotspotDescriptors(
      [makeFeature({ unitId: "unit-001", tidepoolScore: 78, beachcombingScore: 45 })],
      "beachcombing",
      SOURCE,
      CREDIT,
    );
    const hotspot = dataMap.get("unit-001")!;
    expect(hotspot.tidepoolScore).toBe(78);
    expect(hotspot.beachcombingScore).toBe(45);
  });

  it("hotspot tidepool signals carry the correct whySummary and chips", () => {
    const { dataMap } = buildIntertidalHotspotDescriptors(
      [makeFeature({ unitId: "unit-001" })],
      "tidepool",
      SOURCE,
      CREDIT,
    );
    const sig = dataMap.get("unit-001")!.signals.tidepool;
    expect(sig.whySummary).toBe("High biodiversity tidepool habitat");
    expect(sig.bioband).toBe("Barnacle zone");
    expect(sig.energy).toBe("High");
    expect(sig.debris).toBeNull();
    expect(sig.humanUse).toBeNull();
  });

  it("hotspot beachcombing signals carry the correct whySummary and chips", () => {
    const { dataMap } = buildIntertidalHotspotDescriptors(
      [makeFeature({ unitId: "unit-001" })],
      "beachcombing",
      SOURCE,
      CREDIT,
    );
    const sig = dataMap.get("unit-001")!.signals.beachcombing;
    expect(sig.whySummary).toBe("Good beachcombing conditions");
    expect(sig.debris).toBe("Drift log");
    expect(sig.humanUse).toBe("Recreational");
    expect(sig.energy).toBe("Low");
    expect(sig.bioband).toBeNull();
  });

  it("hotspot sourceName and creditUrl match the arguments passed in", () => {
    const { dataMap } = buildIntertidalHotspotDescriptors(
      [makeFeature({ unitId: "unit-001" })],
      "tidepool",
      "Custom Source",
      "https://example.com/",
    );
    const hotspot = dataMap.get("unit-001")!;
    expect(hotspot.sourceName).toBe("Custom Source");
    expect(hotspot.creditUrl).toBe("https://example.com/");
  });

  it("clicking a pin (unitId lookup) returns the full SelectedHotspot object", () => {
    const features = [
      makeFeature({ unitId: "pin-A", tidepoolScore: 72, beachcombingScore: 38 }),
    ];
    const { pins, dataMap } = buildIntertidalHotspotDescriptors(
      features,
      "tidepool",
      SOURCE,
      CREDIT,
    );

    const hitUnitId = pins[0].unitId;
    const hotspot = dataMap.get(hitUnitId);

    expect(hotspot).toBeDefined();
    expect(hotspot!.unitId).toBe("pin-A");
    expect(hotspot!.tidepoolScore).toBe(72);
    expect(hotspot!.beachcombingScore).toBe(38);
    expect(hotspot!.signals.tidepool.whySummary).toBe(
      "High biodiversity tidepool habitat",
    );
    expect(hotspot!.signals.beachcombing.whySummary).toBe(
      "Good beachcombing conditions",
    );
  });

  it("switching from tidepool to beachcombing changes pin color and score while keeping both signals", () => {
    const features = [makeFeature({ unitId: "unit-001", tidepoolScore: 90, beachcombingScore: 55 })];

    const tp = buildIntertidalHotspotDescriptors(features, "tidepool", SOURCE, CREDIT);
    expect(tp.pins[0].color).toBe("#0d9488");
    expect(tp.pins[0].score).toBe(90);
    expect(tp.dataMap.get("unit-001")!.signals.beachcombing.whySummary).toBe(
      "Good beachcombing conditions",
    );

    const bc = buildIntertidalHotspotDescriptors(features, "beachcombing", SOURCE, CREDIT);
    expect(bc.pins[0].color).toBe("#d97706");
    expect(bc.pins[0].score).toBe(55);
    expect(bc.dataMap.get("unit-001")!.signals.tidepool.whySummary).toBe(
      "High biodiversity tidepool habitat",
    );
  });
});
