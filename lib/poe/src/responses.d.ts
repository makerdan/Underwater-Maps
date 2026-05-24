import type { PoeRespondParams, PoeResponseResult } from "./types.js";
import { z } from "zod";
export declare function poeRespond(params: PoeRespondParams): Promise<PoeResponseResult>;
export declare function validateWithSchema<T>(text: string, schema: z.ZodType<T>): T;
