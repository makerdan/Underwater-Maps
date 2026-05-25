// React 19's component-profiling path calls performance.measure(name, {start,
// end, detail}) where `detail` may include component refs, Three.js objects,
// or other non-cloneable values. The browser's Performance Timeline must
// structured-clone `detail`, and when it can't it throws a DataCloneError.
// That unhandled error trips the Replit runtime-error overlay and looks like
// a hard crash even though React keeps running.
//
// Patch performance.measure so a DataCloneError silently retries without the
// uncloneable `detail`, preserving the start/end timing and never throwing.
export function patchPerformanceMeasure(): void {
  if (typeof performance === "undefined" || typeof performance.measure !== "function") {
    return;
  }
  const w = performance as Performance & { __bathyMeasurePatched?: boolean };
  if (w.__bathyMeasurePatched) return;
  w.__bathyMeasurePatched = true;

  const original = performance.measure.bind(performance) as Performance["measure"];

  performance.measure = function patchedMeasure(
    measureName: string,
    startOrOptions?: string | PerformanceMeasureOptions,
    endMark?: string,
  ): PerformanceMeasure {
    try {
      return original(measureName, startOrOptions as never, endMark as never);
    } catch (err) {
      if (err instanceof DOMException && err.name === "DataCloneError" &&
          startOrOptions && typeof startOrOptions === "object") {
        const { start, end, duration } = startOrOptions as PerformanceMeasureOptions;
        try {
          return original(measureName, { start, end, duration } as never);
        } catch {
          // Last resort: name-only measure can't fail on clone.
          return original(measureName) as PerformanceMeasure;
        }
      }
      throw err;
    }
  } as Performance["measure"];
}
