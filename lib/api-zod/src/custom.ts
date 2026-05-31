import * as zod from "zod";

const SubsystemStatus = zod.object({
  status: zod.enum(["ok", "degraded"]),
  latencyMs: zod.number().optional(),
  error: zod.string().optional(),
});

export const DeepHealthCheckResponse = zod.object({
  status: zod.enum(["ok", "degraded"]),
  subsystems: zod.object({
    db: SubsystemStatus,
    poe: SubsystemStatus,
    aoos: SubsystemStatus,
  }),
});

export type DeepHealthCheckResponse = zod.infer<typeof DeepHealthCheckResponse>;
