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

export type MarkerFormInput = z.infer<typeof markerFormSchema>;
