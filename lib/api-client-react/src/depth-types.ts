/**
 * Shared depth-array type derived directly from TerrainData["depths"].
 *
 * Because this is an indexed-access type rather than a copy, any future change
 * to `TerrainData.depths` in the orval-generated schema (e.g. widening to
 * `(number | null | undefined)[]`) is automatically reflected here.
 * TypeScript will immediately surface every non-conforming consumer at the
 * next typecheck run — no manual sync required.
 *
 * Usage
 * -----
 *   import type { DepthsArray } from "@workspace/api-client-react";
 *
 *   function myFn(depths: DepthsArray) { … }
 *
 * This file is hand-authored and intentionally separate from the orval-
 * generated `api.schemas.ts` so it survives codegen regeneration.
 * See the `depths` field of `TerrainData` in `src/generated/api.schemas.ts`
 * for the original definition.
 */
import type { TerrainData } from "./generated/api.schemas";

/** Row-major flat array of depth values as emitted by `TerrainData.depths`.
 *  `null` entries represent unfilled survey-gap cells. */
export type DepthsArray = TerrainData["depths"];
