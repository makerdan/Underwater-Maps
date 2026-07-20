import { describe, it, expect } from "vitest";
import {
  MARKER_LABEL_MAX,
  MARKER_NOTES_MAX,
  markerLabelSchema,
  markerNotesSchema,
} from "../markerFormSchema";
import {
  SALTWATER_MARKER_TYPES,
  FRESHWATER_MARKER_TYPES,
} from "../markerConstants";
import {
  postMarkersBodyLabelMax,
  postMarkersBodyNotesMax,
  patchMarkersIdBodyNotesMax,
  PostMarkersBody,
  PatchMarkersIdBody,
} from "@workspace/api-zod";

// ---------------------------------------------------------------------------
// Derive the union type values from both layers for type-enum parity checks
// ---------------------------------------------------------------------------

const FRONTEND_MARKER_VALUES = new Set<string>([
  ...SALTWATER_MARKER_TYPES.map((t) => t.value as string),
  ...FRESHWATER_MARKER_TYPES.map((t) => t.value as string),
]);

// PostMarkersBody.shape.type is ZodDefault<ZodEnum<[...]>> — drill into
// _def.innerType to reach the ZodEnum, then read .options for the value list.
// Using _def directly is more reliable than .unwrap() across Zod versions.
type ZodLike = {
  _def?: { innerType?: { options?: readonly string[] }; values?: readonly string[] };
  options?: readonly string[];
};
const _typeField = PostMarkersBody.shape["type"] as unknown as ZodLike;
const SERVER_MARKER_ENUM_VALUES: Set<string> = new Set(
  _typeField._def?.innerType?.options ??   // ZodDefault wrapping ZodEnum
  _typeField._def?.values ??               // ZodEnum directly (v4 shape)
  _typeField.options ??                    // ZodEnum.options shorthand
  [],
);

// ---------------------------------------------------------------------------
// Label / notes length parity (existing tests)
// ---------------------------------------------------------------------------

describe("cross-layer consistency: markerFormSchema vs PostMarkersBody", () => {
  it("frontend MARKER_LABEL_MAX (200) matches server postMarkersBodyLabelMax (200)", () => {
    expect(MARKER_LABEL_MAX).toBe(200);
    expect(postMarkersBodyLabelMax).toBe(200);
    expect(MARKER_LABEL_MAX).toBe(postMarkersBodyLabelMax);
  });

  it("frontend MARKER_NOTES_MAX (2000) matches server postMarkersBodyNotesMax (2000)", () => {
    expect(MARKER_NOTES_MAX).toBe(2000);
    expect(postMarkersBodyNotesMax).toBe(2000);
    expect(MARKER_NOTES_MAX).toBe(postMarkersBodyNotesMax);
  });

  it("frontend markerLabelSchema rejects a label one character over the shared limit", () => {
    const over = "a".repeat(MARKER_LABEL_MAX + 1);
    expect(markerLabelSchema.safeParse(over).success).toBe(false);
  });

  it("server PostMarkersBody rejects a label one character over the shared limit", () => {
    const over = "a".repeat(postMarkersBodyLabelMax + 1);
    const body = { datasetId: "ds-1", lon: -136.0, lat: 58.0, depth: 50, label: over };
    expect(PostMarkersBody.safeParse(body).success).toBe(false);
  });

  it("frontend markerLabelSchema accepts a label at exactly the shared limit", () => {
    const atLimit = "a".repeat(MARKER_LABEL_MAX);
    expect(markerLabelSchema.safeParse(atLimit).success).toBe(true);
  });

  it("server PostMarkersBody accepts a label at exactly the shared limit", () => {
    const atLimit = "a".repeat(postMarkersBodyLabelMax);
    const body = { datasetId: "ds-1", lon: -136.0, lat: 58.0, depth: 50, label: atLimit };
    expect(PostMarkersBody.safeParse(body).success).toBe(true);
  });

  it("frontend markerNotesSchema rejects notes one character over the shared limit", () => {
    const over = "n".repeat(MARKER_NOTES_MAX + 1);
    expect(markerNotesSchema.safeParse(over).success).toBe(false);
  });

  it("server PostMarkersBody rejects notes one character over the shared limit", () => {
    const over = "n".repeat(postMarkersBodyNotesMax + 1);
    const body = { datasetId: "ds-1", lon: -136.0, lat: 58.0, depth: 50, label: "Test", notes: over };
    expect(PostMarkersBody.safeParse(body).success).toBe(false);
  });

  it("frontend markerNotesSchema accepts notes at exactly the shared limit", () => {
    const atLimit = "n".repeat(MARKER_NOTES_MAX);
    expect(markerNotesSchema.safeParse(atLimit).success).toBe(true);
  });

  it("server PostMarkersBody accepts notes at exactly the shared limit", () => {
    const atLimit = "n".repeat(postMarkersBodyNotesMax);
    const body = { datasetId: "ds-1", lon: -136.0, lat: 58.0, depth: 50, label: "Test", notes: atLimit };
    expect(PostMarkersBody.safeParse(body).success).toBe(true);
  });

  it("patchMarkersIdBodyNotesMax matches MARKER_NOTES_MAX and postMarkersBodyNotesMax — PATCH and POST share the same 2000-char notes cap", () => {
    expect(patchMarkersIdBodyNotesMax).toBe(MARKER_NOTES_MAX);
    expect(patchMarkersIdBodyNotesMax).toBe(postMarkersBodyNotesMax);
    expect(patchMarkersIdBodyNotesMax).toBe(2000);
  });

  it("server PatchMarkersIdBody accepts notes at exactly 2000 characters", () => {
    const atLimit = "n".repeat(patchMarkersIdBodyNotesMax);
    expect(PatchMarkersIdBody.safeParse({ notes: atLimit }).success).toBe(true);
  });

  it("server PatchMarkersIdBody rejects notes one character over 2000", () => {
    const over = "n".repeat(patchMarkersIdBodyNotesMax + 1);
    expect(PatchMarkersIdBody.safeParse({ notes: over }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Marker type enum parity: every frontend type is accepted by the server, and
// vice versa — no type silently accepted on one side and rejected on the other.
// ---------------------------------------------------------------------------

describe("cross-layer consistency: marker type enum parity", () => {
  it("every saltwater marker type is accepted by PostMarkersBody.type", () => {
    for (const t of SALTWATER_MARKER_TYPES) {
      const result = PostMarkersBody.safeParse({
        datasetId: "ds-1",
        lon: -136.0,
        lat: 58.0,
        depth: 50,
        label: "Test",
        type: t.value,
      });
      expect(result.success, `saltwater type "${t.value}" rejected by server schema`).toBe(true);
    }
  });

  it("every freshwater marker type is accepted by PostMarkersBody.type", () => {
    for (const t of FRESHWATER_MARKER_TYPES) {
      const result = PostMarkersBody.safeParse({
        datasetId: "ds-1",
        lon: -136.0,
        lat: 58.0,
        depth: 50,
        label: "Test",
        type: t.value,
      });
      expect(result.success, `freshwater type "${t.value}" rejected by server schema`).toBe(true);
    }
  });

  it("every server enum value is present in the frontend MARKER_TYPES list", () => {
    for (const serverType of SERVER_MARKER_ENUM_VALUES) {
      expect(
        FRONTEND_MARKER_VALUES.has(serverType),
        `server enum value "${serverType}" has no matching frontend marker type`,
      ).toBe(true);
    }
  });

  it("frontend has no types that are absent from the server enum", () => {
    for (const frontendType of FRONTEND_MARKER_VALUES) {
      expect(
        SERVER_MARKER_ENUM_VALUES.has(frontendType),
        `frontend type "${frontendType}" is absent from the server enum`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Coordinate range parity: both sides accept unconstrained (any finite) numbers
// for lon/lat/depth — neither layer imposes min/max bounds, so a value like
// lon=999 must pass rather than being silently range-clamped on one side only.
// ---------------------------------------------------------------------------

describe("cross-layer consistency: coordinate ranges (unconstrained on both sides)", () => {
  const extremeCoords = [
    { lon: -180, lat: -90, depth: 0 },
    { lon: 180, lat: 90, depth: 11000 },
    { lon: 0, lat: 0, depth: -1 },
  ];

  for (const { lon, lat, depth } of extremeCoords) {
    it(`server accepts lon=${lon}, lat=${lat}, depth=${depth} without range rejection`, () => {
      const result = PostMarkersBody.safeParse({
        datasetId: "ds-1",
        lon,
        lat,
        depth,
        label: "Test",
      });
      expect(result.success).toBe(true);
    });
  }
});
