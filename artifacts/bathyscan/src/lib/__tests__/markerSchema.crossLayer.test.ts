import { describe, it, expect } from "vitest";
import {
  MARKER_LABEL_MAX,
  MARKER_NOTES_MAX,
  markerLabelSchema,
  markerNotesSchema,
} from "../markerFormSchema";
import {
  postMarkersBodyLabelMax,
  postMarkersBodyNotesMax,
  PostMarkersBody,
} from "@workspace/api-zod";

describe("cross-layer consistency: markerFormSchema vs PostMarkersBody", () => {
  it("frontend MARKER_LABEL_MAX matches server postMarkersBodyLabelMax", () => {
    expect(MARKER_LABEL_MAX).toBe(postMarkersBodyLabelMax);
  });

  it("frontend MARKER_NOTES_MAX matches server postMarkersBodyNotesMax", () => {
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
});
