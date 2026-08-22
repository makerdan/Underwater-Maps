import { z } from "zod";

const NO_CONTROL_CHARS = /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/u;

export const MARKER_LABEL_MAX = 200;

export const markerLabelSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(
    z
      .string()
      .min(1, "Label is required")
      .max(MARKER_LABEL_MAX, `Label must be ${MARKER_LABEL_MAX} characters or fewer`)
      .regex(NO_CONTROL_CHARS, "Label contains invalid control characters"),
  );

export const MARKER_NOTES_MAX = 2000;

export const markerNotesSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(
    z
      .string()
      .max(MARKER_NOTES_MAX, `Notes must be ${MARKER_NOTES_MAX} characters or fewer`)
      .regex(NO_CONTROL_CHARS, "Notes contain invalid control characters"),
  );

export const markerFormSchema = z.object({
  label: markerLabelSchema,
  notes: markerNotesSchema.optional().default(""),
});

export const markerAreaSchema = z.discriminatedUnion("shape", [
  z.object({
    shape: z.literal("circle"),
    center: z.object({ lon: z.number().finite(), lat: z.number().finite() }),
    radiusM: z.number().finite().gt(0).max(100000),
  }),
  z.object({
    shape: z.literal("polygon"),
    vertices: z.array(z.object({ lon: z.number().finite(), lat: z.number().finite() })).min(3).max(100),
  }),
]);

/** The fishing guide is intentionally a heuristic, not a biological rule. */
export const SALMON_GUIDE_MIN_FT = 20;
export const SALMON_GUIDE_MAX_FT = 100;
export function salmonGuideRange(units: "metric" | "imperial"): { min: number; max: number; label: string } {
  if (units === "imperial") return { min: 20, max: 100, label: "20–100 ft" };
  return { min: 6.096, max: 30.48, label: "6.1–30.5 m" };
}

export type MarkerFormInput = z.infer<typeof markerFormSchema>;
