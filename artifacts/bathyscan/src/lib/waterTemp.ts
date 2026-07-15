/**
 * waterTemp — water-temperature model used by the HUD readout and marker
 * detail card.
 *
 * Strategy:
 *   1. The surface anchor (depth = 0 m) is sourced from a live ocean SST
 *      feed via `useSurfaceTemperature` — Open-Meteo's Marine API, fetched
 *      through /api/water-temperature for the dataset centre / GPS point.
 *   2. Below the surface we still need an estimate of how the column cools
 *      with depth (the global thermocline). BathyScan does not have a
 *      live, dataset-wide temperature profile, so we apply a simple
 *      exponential decay from the live surface value toward a cold-floor
 *      asymptote. This keeps the depth response of the chip meaningful
 *      without inventing data points we don't have.
 *   3. When the live SST feed is unavailable we fall back to a fixed
 *      surface anchor so the chip degrades gracefully instead of going
 *      blank — callers can surface this fallback state to the user via
 *      the returned `source`.
 */

/** Temperature the deep water column asymptotes toward (°C). */
const DEEP_C = 3;
/** Depth (m) at which ~63% of the surface→deep transition has happened. */
const THERMOCLINE_SCALE_M = 60;
/** Fallback surface temperature used when no live SST is available (°C). */
const FALLBACK_SURFACE_C = 15;

export interface WaterTempSample {
  /** Estimated temperature at `depthMetres`, or null when depth is unknown. */
  celsius: number | null;
  /** Human-readable attribution for the surface anchor used. */
  source: string;
  /** True when the surface anchor came from the live feed. */
  live: boolean;
  /** Surface SST (°C) used as the model anchor. */
  surfaceC: number;
  /** ISO timestamp of the surface sample, when known. */
  timestamp: string | null;
  /** Canonical URL for the data source (when applicable). */
  sourceUrl: string | null;
}

export interface SurfaceAnchor {
  /** Live sea-surface temperature in °C, or null when unavailable. */
  sstCelsius: number | null;
  /** Human-readable source label (e.g. "Open-Meteo Marine API"). */
  source: string | null;
  /** Canonical URL for the source. */
  sourceUrl: string | null;
  /** ISO timestamp of the live sample. */
  timestamp: string | null;
}

/**
 * Estimate water temperature (°C) at the given depth in metres, using
 * `anchor` as the live surface SST when available. Returns null when depth
 * is unknown / non-finite so callers can render an em-dash.
 */
export function estimateWaterTemperature(
  depthMetres: number | null | undefined,
  anchor?: SurfaceAnchor | null,
): WaterTempSample {
  const live = !!(anchor && typeof anchor.sstCelsius === "number" && Number.isFinite(anchor.sstCelsius));
  const surfaceC = live ? (anchor!.sstCelsius as number) : FALLBACK_SURFACE_C;
  const source = live
    ? (anchor!.source ?? "Live ocean feed")
    : "Estimated thermocline (no live feed)";
  const sourceUrl = live ? (anchor?.sourceUrl ?? null) : null;
  const timestamp = live ? (anchor?.timestamp ?? null) : null;

  if (depthMetres === null || depthMetres === undefined || !Number.isFinite(depthMetres)) {
    return { celsius: null, source, live, surfaceC, timestamp, sourceUrl };
  }
  const d = Math.max(0, depthMetres);
  // Decay toward DEEP_C, but never warmer than the surface anchor.
  const deep = Math.min(DEEP_C, surfaceC);
  const celsius = deep + (surfaceC - deep) * Math.exp(-d / THERMOCLINE_SCALE_M);
  return { celsius, source, live, surfaceC, timestamp, sourceUrl };
}

/**
 * Back-compat shim: returns just the °C value for callers that don't need
 * source metadata. Uses the deterministic fallback anchor (no live data).
 */
export function waterTemperatureC(depthMetres: number | null | undefined): number | null {
  return estimateWaterTemperature(depthMetres, null).celsius;
}

export interface TemperatureProfileSample {
  depthM: number;
  celsius: number;
}

export interface TemperatureProfile {
  /** Sorted shallow→deep samples for plotting depth vs °C. */
  samples: TemperatureProfileSample[];
  /** Surface anchor (°C). */
  surfaceC: number;
  /** Deep-water asymptote (°C) used by the model. */
  deepC: number;
  /** Maximum depth (m) covered by the profile. */
  maxDepthM: number;
  /** Human-readable attribution. */
  source: string;
  /** Canonical URL for the data source (when applicable). */
  sourceUrl: string | null;
  /** ISO timestamp of the live surface sample, when known. */
  timestamp: string | null;
  /** True when the surface anchor came from the live SST feed. */
  live: boolean;
  /** Model name — currently only the local exponential thermocline. */
  model: "exponential-thermocline";
}

/**
 * Sample the thermocline model at a series of depths so a chart can render
 * the full temperature-vs-depth profile, not just a single point.
 *
 * The data is computed locally — it shares the live SST surface anchor with
 * `estimateWaterTemperature` so the chart line passes exactly through the
 * point shown in the HUD chip. When a real per-location depth profile (Argo
 * float cast, Copernicus reanalysis, uploaded CTD metadata, …) is wired up
 * later, this function is the single point to swap.
 */
export function sampleTemperatureProfile(
  maxDepthM: number | null | undefined,
  anchor?: SurfaceAnchor | null,
  steps = 24,
): TemperatureProfile {
  const live = !!(anchor && typeof anchor.sstCelsius === "number" && Number.isFinite(anchor.sstCelsius));
  const surfaceC = live ? (anchor!.sstCelsius as number) : FALLBACK_SURFACE_C;
  const deep = Math.min(DEEP_C, surfaceC);

  const requested = typeof maxDepthM === "number" && Number.isFinite(maxDepthM) ? maxDepthM : 200;
  // Clamp so the chart always has shape (a few metres makes a useless plot)
  // and never blows up on absurd inputs.
  const safeMax = Math.max(20, Math.min(2000, Math.abs(requested)));
  const safeSteps = Math.max(2, Math.min(200, Math.floor(steps)));

  const samples: TemperatureProfileSample[] = [];
  for (let i = 0; i <= safeSteps; i++) {
    const d = (i / safeSteps) * safeMax;
    samples.push({
      depthM: d,
      celsius: deep + (surfaceC - deep) * Math.exp(-d / THERMOCLINE_SCALE_M),
    });
  }

  return {
    samples,
    surfaceC,
    deepC: deep,
    maxDepthM: safeMax,
    source: live
      ? `${anchor!.source ?? "Live ocean feed"} surface + estimated thermocline`
      : "Estimated thermocline (no live feed)",
    sourceUrl: live ? (anchor?.sourceUrl ?? null) : null,
    timestamp: live ? (anchor?.timestamp ?? null) : null,
    live,
    model: "exponential-thermocline",
  };
}

/**
 * Minimal shape we need from the server's TemperatureProfile DTO. Kept
 * structural so this module doesn't take a direct dependency on the
 * generated API client (which simplifies testing).
 */
export interface RealTemperatureProfile {
  available?: boolean;
  samples?: { depthM: number; temperatureC: number }[];
  source?: string;
  sourceUrl?: string;
  timestamp?: string;
  provider?: string;
}

export interface ResolvedTemperatureProfile {
  profile: TemperatureProfile;
  /** True when the samples came from a real measurement source. */
  measured: boolean;
}

/**
 * Linearly interpolate temperature (°C) at `depthM` from a sorted array of
 * (depthM, celsius) profile samples. Returns null when the samples array is
 * empty. Out-of-range depths clamp to the nearest endpoint so callers
 * never receive undefined for reasonable inputs.
 */
export function interpolateTempAtDepth(
  samples: { depthM: number; celsius: number }[],
  depthM: number,
): number | null {
  if (!samples || samples.length === 0) return null;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  if (depthM <= first.depthM) return first.celsius;
  if (depthM >= last.depthM) return last.celsius;
  for (let i = 0; i < samples.length - 1; i++) {
    const lo = samples[i]!;
    const hi = samples[i + 1]!;
    if (depthM <= hi.depthM) {
      const span = hi.depthM - lo.depthM;
      const alpha = span === 0 ? 0 : (depthM - lo.depthM) / span;
      return lo.celsius + (hi.celsius - lo.celsius) * alpha;
    }
  }
  return last.celsius;
}

/**
 * Pick the best available depth profile for a location: prefer a real
 * measured cast (bundled CTD / Argo / reanalysis) when the server returns
 * one, otherwise fall back to the surface-anchored thermocline model.
 *
 * This is the single decision point shared by the HUD chip popover and
 * any other component that wants to render the same data — it guarantees
 * the chart always shows real measurements when they exist and
 * gracefully degrades when they don't.
 */
export function resolveTemperatureProfile(
  real: RealTemperatureProfile | null | undefined,
  anchor: SurfaceAnchor | null | undefined,
  fallbackMaxDepthM: number | null | undefined,
): ResolvedTemperatureProfile {
  if (real && real.available && Array.isArray(real.samples) && real.samples.length >= 2) {
    const samples = [...real.samples]
      .filter(
        (s): s is { depthM: number; temperatureC: number } =>
          typeof s?.depthM === "number" &&
          Number.isFinite(s.depthM) &&
          typeof s?.temperatureC === "number" &&
          Number.isFinite(s.temperatureC),
      )
      .sort((a, b) => a.depthM - b.depthM)
      .map((s) => ({ depthM: s.depthM, celsius: s.temperatureC }));
    if (samples.length >= 2) {
      const surfaceC = samples[0]!.celsius;
      const deepC = samples[samples.length - 1]!.celsius;
      const maxDepthM = samples[samples.length - 1]!.depthM;
      return {
        measured: true,
        profile: {
          samples,
          surfaceC,
          deepC,
          maxDepthM,
          source: real.source ?? "Measured profile",
          sourceUrl: real.sourceUrl ?? null,
          timestamp: real.timestamp ?? null,
          live: true,
          model: "exponential-thermocline",
        },
      };
    }
  }
  return {
    measured: false,
    profile: sampleTemperatureProfile(fallbackMaxDepthM, anchor ?? null),
  };
}
