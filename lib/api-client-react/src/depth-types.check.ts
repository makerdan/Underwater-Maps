/**
 * Compile-time sync guard: DepthsArray vs TerrainData["depths"]
 *
 * This file contains NO runtime code. Its sole purpose is to assert at
 * typecheck time that `DepthsArray` (hand-authored in depth-types.ts) and
 * `TerrainData["depths"]` (orval-generated in api.schemas.ts) remain mutually
 * assignable — i.e. they are the same effective type — after every codegen run.
 *
 * WHY THIS EXISTS
 * ---------------
 * `DepthsArray` is currently defined as `TerrainData["depths"]` (indexed-access
 * type), so divergence cannot happen today. But if depth-types.ts is ever
 * manually edited to spell out the type explicitly — e.g.
 *   export type DepthsArray = (number | null)[];
 * — a subsequent schema change (e.g. widening to `(number | null | undefined)[]`)
 * would silently leave all consumers with the wrong type. This file turns that
 * silent failure into a hard typecheck error.
 *
 * WHERE IT RUNS
 * -------------
 * This file is compiled by every `tsc --build` call (pnpm run typecheck:libs),
 * which is part of both:
 *   • pnpm codegen   — runs typecheck:libs at the end
 *   • pnpm typecheck — runs codegen:generate then typecheck:libs
 *
 * HOW TO READ A FAILURE
 * ---------------------
 * TypeScript error "Type 'never' is not assignable to type 'true'" on either
 * export line below means the two types have diverged. Fix by either:
 *   a) Restoring depth-types.ts to the indexed-access form:
 *        export type DepthsArray = TerrainData["depths"];
 *   b) Updating the manual type in depth-types.ts to match the new schema.
 */

import type { TerrainData } from "./generated/api.schemas";
import type { DepthsArray } from "./depth-types";

type _DepthsFieldExtendsDepthsArray = TerrainData["depths"] extends DepthsArray
  ? true
  : never;

type _DepthsArrayExtendsDepthsField = DepthsArray extends TerrainData["depths"]
  ? true
  : never;

export const _depthsFieldGuard: _DepthsFieldExtendsDepthsArray = true;
export const _depthsArrayGuard: _DepthsArrayExtendsDepthsField = true;
