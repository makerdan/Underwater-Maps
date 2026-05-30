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
});
