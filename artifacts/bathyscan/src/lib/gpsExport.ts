/**
 * gpsExport.ts — serializers for GPS waypoint / route files.
 *
 * Sibling to `gpsImport.ts`. Takes the user's BathyScan markers and trolling
 * presets and renders them as GPX 1.1 or KML 2.2 text. Markers become
 * waypoints; trolling presets become routes (GPX <rte> / KML LineString).
 *
 * Pure utility module — no React, no network. The DOM-touching download
 * helper is also exposed here so callers don't need to reimplement the
 * Blob/anchor dance.
 */

import { triggerBlobDownload } from "./blobDownload";

export interface ExportMarker {
  lon: number;
  lat: number;
  /** Depth in metres below the surface (positive = deeper). */
  depth: number;
  label: string;
  type: string;
  notes?: string | null;
  /** Catch-journal symbols logged at this spot, one per entry (appended to desc). */
  catchSymbols?: string[];
}

/**
 * Combine marker notes with catch-journal symbols into a single description
 * string for GPX <desc> / KML <description>. Returns "" when there is
 * nothing to describe.
 */
export function buildMarkerDescription(m: ExportMarker): string {
  const parts: string[] = [];
  if (m.notes && m.notes.trim().length > 0) parts.push(m.notes.trim());
  if (m.catchSymbols && m.catchSymbols.length > 0) {
    parts.push(`Catches: ${m.catchSymbols.join(" ")}`);
  }
  return parts.join(" | ");
}

export interface ExportRoutePoint {
  lon: number;
  lat: number;
}

export interface ExportRoute {
  name: string;
  points: ExportRoutePoint[];
}

export interface ExportData {
  markers: ExportMarker[];
  routes: ExportRoute[];
  /** Dataset name (used as the GPX/KML document name). */
  datasetName: string;
}

export type ExportFormat = "gpx" | "kml";

// ---------------------------------------------------------------------------
// GPX
// ---------------------------------------------------------------------------

/**
 * Serialize markers + routes as a GPX 1.1 document. Markers go to <wpt>;
 * each route becomes an <rte> with <rtept> children.
 *
 * GPX <ele> is metres above sea level (positive = up); BathyScan depth is
 * positive below the surface, so we negate it.
 */
export function serializeGpx(data: ExportData): string {
  const now = new Date().toISOString();
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(
    `<gpx version="1.1" creator="BathyScan" xmlns="http://www.topografix.com/GPX/1/1">`,
  );
  lines.push(`  <metadata>`);
  lines.push(`    <name>${escXml(data.datasetName)}</name>`);
  lines.push(`    <time>${now}</time>`);
  lines.push(`  </metadata>`);

  for (const m of data.markers) {
    lines.push(
      `  <wpt lat="${fmtCoord(m.lat)}" lon="${fmtCoord(m.lon)}">`,
    );
    if (Number.isFinite(m.depth)) {
      lines.push(`    <ele>${fmtNum(-m.depth)}</ele>`);
    }
    lines.push(`    <name>${escXml(m.label)}</name>`);
    {
      const desc = buildMarkerDescription(m);
      if (desc) lines.push(`    <desc>${escXml(desc)}</desc>`);
    }
    if (m.type) {
      lines.push(`    <sym>${escXml(m.type)}</sym>`);
      lines.push(`    <type>${escXml(m.type)}</type>`);
    }
    lines.push(`  </wpt>`);
  }

  for (const r of data.routes) {
    lines.push(`  <rte>`);
    lines.push(`    <name>${escXml(r.name)}</name>`);
    for (const p of r.points) {
      lines.push(
        `    <rtept lat="${fmtCoord(p.lat)}" lon="${fmtCoord(p.lon)}"/>`,
      );
    }
    lines.push(`  </rte>`);
  }

  lines.push(`</gpx>`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// KML
// ---------------------------------------------------------------------------

/**
 * Serialize markers + routes as a KML 2.2 document. Markers become
 * <Placemark><Point>; routes become <Placemark><LineString>.
 *
 * KML coordinates are `lon,lat,alt` with altitude in metres above sea level
 * (positive = up), so depth is negated.
 */
export function serializeKml(data: ExportData): string {
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<kml xmlns="http://www.opengis.net/kml/2.2">`);
  lines.push(`  <Document>`);
  lines.push(`    <name>${escXml(data.datasetName)}</name>`);

  for (const m of data.markers) {
    const alt = Number.isFinite(m.depth) ? -m.depth : 0;
    lines.push(`    <Placemark>`);
    lines.push(`      <name>${escXml(m.label)}</name>`);
    {
      const desc = buildMarkerDescription(m);
      if (desc) lines.push(`      <description>${escXml(desc)}</description>`);
    }
    lines.push(`      <Point>`);
    lines.push(
      `        <coordinates>${fmtCoord(m.lon)},${fmtCoord(m.lat)},${fmtNum(alt)}</coordinates>`,
    );
    lines.push(`      </Point>`);
    lines.push(`    </Placemark>`);
  }

  for (const r of data.routes) {
    lines.push(`    <Placemark>`);
    lines.push(`      <name>${escXml(r.name)}</name>`);
    lines.push(`      <LineString>`);
    lines.push(`        <coordinates>`);
    for (const p of r.points) {
      lines.push(
        `          ${fmtCoord(p.lon)},${fmtCoord(p.lat)},0`,
      );
    }
    lines.push(`        </coordinates>`);
    lines.push(`      </LineString>`);
    lines.push(`    </Placemark>`);
  }

  lines.push(`  </Document>`);
  lines.push(`</kml>`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Filenames + download
// ---------------------------------------------------------------------------

/**
 * Build a safe download filename of the form `<dataset>-<YYYY-MM-DD>.<ext>`.
 * Strips characters that are awkward in filenames on Windows/macOS/Linux and
 * collapses whitespace.
 */
export function buildExportFilename(
  datasetName: string,
  format: ExportFormat,
  now: Date = new Date(),
): string {
  const slug = slugify(datasetName) || "bathyscan";
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${slug}-${y}-${m}-${d}.${format}`;
}

/**
 * Build the download filename for a bathymetric CSV export from the Overview
 * Map download tool.
 *
 * Format: `bathyscan_<latDir><lat>_<lonDir><lon>_<resolution>.csv`
 * e.g.    `bathyscan_47.6N_122.3W_256.csv`
 *
 * @param centerLat  Geographic centre latitude of the bounding box.
 * @param centerLon  Geographic centre longitude of the bounding box.
 * @param resolution Grid resolution (64 | 256 | 512).
 */
export function buildBathyscanDownloadFilename(
  centerLat: number,
  centerLon: number,
  resolution: number,
): string {
  const latAbs = Math.abs(centerLat).toFixed(1);
  const lonAbs = Math.abs(centerLon).toFixed(1);
  const latDir = centerLat >= 0 ? "N" : "S";
  const lonDir = centerLon >= 0 ? "E" : "W";
  return `bathyscan_${latAbs}${latDir}_${lonAbs}${lonDir}_${resolution}.csv`;
}

function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[^\w.\-\s]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

/**
 * Trigger a browser download of `content` as `filename`. Uses a transient
 * <a download> element and revokes the object URL afterwards.
 *
 * Delegates to `triggerBlobDownload` so the anchor is positioned off-screen
 * rather than hidden via `display:none`, which lets Playwright's download
 * event listener detect the click reliably.
 */
export function downloadTextFile(
  content: string,
  filename: string,
  mimeType: string,
): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  triggerBlobDownload(blob, filename);
}

export function mimeForFormat(format: ExportFormat): string {
  return format === "gpx"
    ? "application/gpx+xml"
    : "application/vnd.google-earth.kml+xml";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function fmtCoord(n: number): string {
  // 7 decimals ≈ 11 mm precision — well beyond any GPS source.
  return Number.isFinite(n) ? n.toFixed(7) : "0";
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  // Drop trailing zeros from a fixed-precision representation.
  return parseFloat(n.toFixed(3)).toString();
}
