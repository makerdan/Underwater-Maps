import { describe, it, expect } from "vitest";
import { markerLabelSchema, markerNotesSchema, markerFormSchema, MARKER_LABEL_MAX, MARKER_NOTES_MAX } from "../markerFormSchema";

describe("markerLabelSchema", () => {
  it("trims whitespace and accepts normal labels", () => {
    const r = markerLabelSchema.safeParse("  Bottom contact  ");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("Bottom contact");
  });

  it("rejects empty / whitespace-only labels", () => {
    expect(markerLabelSchema.safeParse("").success).toBe(false);
    expect(markerLabelSchema.safeParse("   ").success).toBe(false);
  });

  it("rejects labels longer than MARKER_LABEL_MAX characters after trimming", () => {
    const long = "x".repeat(MARKER_LABEL_MAX + 1);
    expect(markerLabelSchema.safeParse(long).success).toBe(false);
    const ok = "x".repeat(MARKER_LABEL_MAX);
    expect(markerLabelSchema.safeParse(ok).success).toBe(true);
  });

  it("rejects labels containing control characters", () => {
    expect(markerLabelSchema.safeParse("bad\u0000label").success).toBe(false);
    expect(markerLabelSchema.safeParse("bell\u0007").success).toBe(false);
  });

  // ── Boundary value tests ────────────────────────────────────────────────

  it(`accepts a label at exactly the ${MARKER_LABEL_MAX}-character limit (boundary)`, () => {
    const atLimit = "a".repeat(MARKER_LABEL_MAX);
    const r = markerLabelSchema.safeParse(atLimit);
    expect(r.success).toBe(true);
  });

  it(`rejects a label at ${MARKER_LABEL_MAX + 1} characters (one over the limit)`, () => {
    const oneOver = "a".repeat(MARKER_LABEL_MAX + 1);
    expect(markerLabelSchema.safeParse(oneOver).success).toBe(false);
  });

  it("rejects a label with an embedded null byte (\\u0000)", () => {
    expect(markerLabelSchema.safeParse("valid\u0000label").success).toBe(false);
  });

  // ── Unicode combining-character edge cases ──────────────────────────────
  //
  // The schema uses Zod's .max() which counts JavaScript code units (.length),
  // not grapheme clusters. A combining diacritic sequence like "a\u0301"
  // (a + combining acute accent → á) has .length === 2 per rendered grapheme.
  // MARKER_LABEL_MAX/2 such pairs occupy exactly MARKER_LABEL_MAX code units —
  // the limit — and should be accepted. One more pair puts it over the limit.

  it(`accepts a ${MARKER_LABEL_MAX / 2}-grapheme combining-diacritic string (${MARKER_LABEL_MAX} code units = limit)`, () => {
    // "a\u0301" = á via combining acute (2 code units, 1 rendered grapheme)
    const halfMax = MARKER_LABEL_MAX / 2;
    const combiningAtLimit = "a\u0301".repeat(halfMax);
    expect(combiningAtLimit.length).toBe(MARKER_LABEL_MAX);
    expect(markerLabelSchema.safeParse(combiningAtLimit).success).toBe(true);
  });

  it(`rejects a ${MARKER_LABEL_MAX / 2 + 1}-grapheme combining-diacritic string (${MARKER_LABEL_MAX + 2} code units > limit)`, () => {
    const halfMaxPlusOne = MARKER_LABEL_MAX / 2 + 1;
    const combiningOverLimit = "a\u0301".repeat(halfMaxPlusOne);
    expect(combiningOverLimit.length).toBe(MARKER_LABEL_MAX + 2);
    expect(markerLabelSchema.safeParse(combiningOverLimit).success).toBe(false);
  });
});

describe("markerNotesSchema", () => {
  it("trims and allows empty notes", () => {
    const r = markerNotesSchema.safeParse("   ");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("");
  });

  it("rejects notes longer than MARKER_NOTES_MAX chars after trimming", () => {
    expect(markerNotesSchema.safeParse("a".repeat(MARKER_NOTES_MAX + 1)).success).toBe(false);
    expect(markerNotesSchema.safeParse("a".repeat(MARKER_NOTES_MAX)).success).toBe(true);
  });

  it("rejects notes with control characters", () => {
    expect(markerNotesSchema.safeParse("noise\u0001here").success).toBe(false);
  });

  // ── Boundary value tests ────────────────────────────────────────────────

  it(`accepts notes at exactly MARKER_NOTES_MAX (${MARKER_NOTES_MAX}) characters (boundary)`, () => {
    const atLimit = "n".repeat(MARKER_NOTES_MAX);
    expect(markerNotesSchema.safeParse(atLimit).success).toBe(true);
  });

  it(`rejects notes at ${MARKER_NOTES_MAX + 1} characters (one over the limit)`, () => {
    const oneOver = "n".repeat(MARKER_NOTES_MAX + 1);
    expect(markerNotesSchema.safeParse(oneOver).success).toBe(false);
  });

  it("rejects notes with an embedded null byte (\\u0000)", () => {
    expect(markerNotesSchema.safeParse("valid notes\u0000here").success).toBe(false);
  });

  // ── Unicode combining-character edge cases ──────────────────────────────
  //
  // MARKER_NOTES_MAX/2 combining-diacritic pairs occupy exactly MARKER_NOTES_MAX
  // code units (= limit).

  it(`accepts ${MARKER_NOTES_MAX / 2}-grapheme combining-diacritic notes (${MARKER_NOTES_MAX} code units = limit)`, () => {
    const halfMax = MARKER_NOTES_MAX / 2;
    const combiningAtLimit = "n\u0303".repeat(halfMax);
    expect(combiningAtLimit.length).toBe(MARKER_NOTES_MAX);
    expect(markerNotesSchema.safeParse(combiningAtLimit).success).toBe(true);
  });

  it(`rejects ${MARKER_NOTES_MAX / 2 + 1}-grapheme combining-diacritic notes (${MARKER_NOTES_MAX + 2} code units > limit)`, () => {
    const halfMaxPlusOne = MARKER_NOTES_MAX / 2 + 1;
    const combiningOverLimit = "n\u0303".repeat(halfMaxPlusOne);
    expect(combiningOverLimit.length).toBe(MARKER_NOTES_MAX + 2);
    expect(markerNotesSchema.safeParse(combiningOverLimit).success).toBe(false);
  });
});

describe("markerFormSchema", () => {
  it("accepts full valid form input", () => {
    const r = markerFormSchema.safeParse({ label: " Reef edge ", notes: "Clear water" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.label).toBe("Reef edge");
      expect(r.data.notes).toBe("Clear water");
    }
  });

  it("defaults notes to empty string when omitted", () => {
    const r = markerFormSchema.safeParse({ label: "Reef edge" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.notes).toBe("");
  });

  it(`accepts a label at exactly ${MARKER_LABEL_MAX} chars with notes at exactly ${MARKER_NOTES_MAX} chars`, () => {
    const r = markerFormSchema.safeParse({
      label: "a".repeat(MARKER_LABEL_MAX),
      notes: "b".repeat(MARKER_NOTES_MAX),
    });
    expect(r.success).toBe(true);
  });

  it(`rejects when label is ${MARKER_LABEL_MAX + 1} chars even if notes are within limits`, () => {
    const r = markerFormSchema.safeParse({
      label: "a".repeat(MARKER_LABEL_MAX + 1),
      notes: "b".repeat(10),
    });
    expect(r.success).toBe(false);
  });

  it(`rejects when notes are ${MARKER_NOTES_MAX + 1} chars even if label is within limits`, () => {
    const r = markerFormSchema.safeParse({
      label: "Valid Label",
      notes: "b".repeat(MARKER_NOTES_MAX + 1),
    });
    expect(r.success).toBe(false);
  });
});
