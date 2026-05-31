import { describe, it, expect } from "vitest";
import { markerLabelSchema, markerNotesSchema, markerFormSchema, MARKER_NOTES_MAX } from "../markerFormSchema";

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

  it("rejects labels longer than 60 characters after trimming", () => {
    const long = "x".repeat(61);
    expect(markerLabelSchema.safeParse(long).success).toBe(false);
    const ok = "x".repeat(60);
    expect(markerLabelSchema.safeParse(ok).success).toBe(true);
  });

  it("rejects labels containing control characters", () => {
    expect(markerLabelSchema.safeParse("bad\u0000label").success).toBe(false);
    expect(markerLabelSchema.safeParse("bell\u0007").success).toBe(false);
  });

  // ── Boundary value tests ────────────────────────────────────────────────

  it("accepts a label at exactly the 60-character limit (boundary)", () => {
    const exactly60 = "a".repeat(60);
    const r = markerLabelSchema.safeParse(exactly60);
    expect(r.success).toBe(true);
  });

  it("rejects a label at 61 characters (one over the limit)", () => {
    const sixtyOne = "a".repeat(61);
    expect(markerLabelSchema.safeParse(sixtyOne).success).toBe(false);
  });

  it("rejects a label with an embedded null byte (\\u0000)", () => {
    expect(markerLabelSchema.safeParse("valid\u0000label").success).toBe(false);
  });

  // ── Unicode combining-character edge cases ──────────────────────────────
  //
  // The schema uses Zod's .max() which counts JavaScript code units (.length),
  // not grapheme clusters. A combining diacritic sequence like "a\u0301"
  // (a + combining acute accent → á) has .length === 2 per rendered grapheme.
  // A 30-grapheme string of such pairs occupies exactly 60 code units — the
  // limit — and should be accepted. A 31-grapheme string occupies 62 code
  // units and should be rejected.

  it("accepts a 30-grapheme combining-diacritic string (60 code units = limit)", () => {
    // "a\u0301" = á via combining acute (2 code units, 1 rendered grapheme)
    // 30 × 2 = 60 code units → at the boundary, accepted.
    const combining30 = "a\u0301".repeat(30);
    expect(combining30.length).toBe(60);
    expect(markerLabelSchema.safeParse(combining30).success).toBe(true);
  });

  it("rejects a 31-grapheme combining-diacritic string (62 code units > limit)", () => {
    // 31 × 2 = 62 code units → over the boundary, rejected.
    const combining31 = "a\u0301".repeat(31);
    expect(combining31.length).toBe(62);
    expect(markerLabelSchema.safeParse(combining31).success).toBe(false);
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

  it("accepts notes at exactly MARKER_NOTES_MAX (280) characters (boundary)", () => {
    const exactly280 = "n".repeat(MARKER_NOTES_MAX);
    expect(markerNotesSchema.safeParse(exactly280).success).toBe(true);
  });

  it("rejects notes at 281 characters (one over the limit)", () => {
    const twoEightyOne = "n".repeat(MARKER_NOTES_MAX + 1);
    expect(markerNotesSchema.safeParse(twoEightyOne).success).toBe(false);
  });

  it("rejects notes with an embedded null byte (\\u0000)", () => {
    expect(markerNotesSchema.safeParse("valid notes\u0000here").success).toBe(false);
  });

  // ── Unicode combining-character edge cases ──────────────────────────────
  //
  // 140 combining-diacritic pairs occupy exactly 280 code units (= limit).

  it("accepts 140-grapheme combining-diacritic notes (280 code units = limit)", () => {
    const combining140 = "n\u0303".repeat(140);
    expect(combining140.length).toBe(280);
    expect(markerNotesSchema.safeParse(combining140).success).toBe(true);
  });

  it("rejects 141-grapheme combining-diacritic notes (282 code units > limit)", () => {
    const combining141 = "n\u0303".repeat(141);
    expect(combining141.length).toBe(282);
    expect(markerNotesSchema.safeParse(combining141).success).toBe(false);
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

  it("accepts a label at exactly 60 chars with notes at exactly 280 chars", () => {
    const r = markerFormSchema.safeParse({
      label: "a".repeat(60),
      notes: "b".repeat(280),
    });
    expect(r.success).toBe(true);
  });

  it("rejects when label is 61 chars even if notes are within limits", () => {
    const r = markerFormSchema.safeParse({
      label: "a".repeat(61),
      notes: "b".repeat(10),
    });
    expect(r.success).toBe(false);
  });

  it("rejects when notes are 281 chars even if label is within limits", () => {
    const r = markerFormSchema.safeParse({
      label: "Valid Label",
      notes: "b".repeat(281),
    });
    expect(r.success).toBe(false);
  });
});
