import { describe, it, expect } from "vitest";

/**
 * Mirrors the escapeXml helper from WeatherPanel.tsx.
 * If that implementation changes, update this copy too.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface WaypointStub {
  lat: number;
  lon: number;
  hour: number;
  driftSpeedKnots: number;
  lineAngleDeg: number;
  hookDepthM: number;
  isSlack: boolean;
  bottomReached: boolean;
  /** Optional override for the <desc> text — lets tests inject arbitrary strings. */
  descOverride?: string;
}

/**
 * Mirrors the XML assembly block in WeatherPanel.tsx `handleExportGpx`.
 * Keep in sync with the source; the purpose of this test is to verify the
 * *document-level* well-formedness, not to re-test escapeXml in isolation.
 *
 * descOverride on a waypoint replaces the auto-generated description so tests
 * can inject XML-special characters into the <desc> element.
 */
function buildGpx(planName: string, waypoints: WaypointStub[]): string {
  const now = "2026-01-01T00:00:00.000Z";
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<gpx version="1.1" creator="BathyScan Drift Planner" xmlns="http://www.topografix.com/GPX/1/1">\n`;
  xml += `  <metadata><name>${escapeXml(planName)}</name><time>${now}</time></metadata>\n`;
  xml += `  <trk>\n    <name>${escapeXml(planName)}</name>\n    <trkseg>\n`;
  for (const wp of waypoints) {
    const time = new Date(
      new Date(now).getTime() + wp.hour * 3600000
    ).toISOString();
    const desc =
      wp.descOverride ??
      (`Hour ${wp.hour}: ${wp.driftSpeedKnots.toFixed(1)} kt drift, ` +
        `line ${Math.round(wp.lineAngleDeg)}°, hook ${Math.round(wp.hookDepthM)} m` +
        `${wp.isSlack ? ", slack" : ""}${wp.bottomReached ? ", BOTTOM" : ""}`);
    xml += `      <trkpt lat="${wp.lat.toFixed(7)}" lon="${wp.lon.toFixed(7)}">\n`;
    xml += `        <ele>${(-wp.hookDepthM).toFixed(1)}</ele>\n`;
    xml += `        <time>${time}</time>\n`;
    xml += `        <desc>${escapeXml(desc)}</desc>\n`;
    xml += `      </trkpt>\n`;
  }
  xml += `    </trkseg>\n  </trk>\n</gpx>`;
  return xml;
}

/** Returns true when DOMParser reports no parse errors. */
function isWellFormedXml(xml: string): boolean {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const errors = doc.getElementsByTagNameNS(
    "http://www.mozilla.org/newlayout/xml/parsererror.xml",
    "parsererror"
  );
  if (errors.length > 0) return false;
  const rootError = doc.querySelector("parsererror");
  return rootError === null;
}

const PLAIN_WAYPOINT: WaypointStub = {
  lat: 47.123456,
  lon: -122.654321,
  hour: 1,
  driftSpeedKnots: 1.5,
  lineAngleDeg: 90,
  hookDepthM: 30,
  isSlack: false,
  bottomReached: false,
};

describe("GPX export — integration (full XML document)", () => {
  // ── Plan-name escaping ────────────────────────────────────────────────────

  it("produces well-formed XML for a plain ASCII plan name", () => {
    const xml = buildGpx("My Drift Plan", [PLAIN_WAYPOINT]);
    expect(isWellFormedXml(xml)).toBe(true);
  });

  it("stays well-formed when plan name contains '<' and '>'", () => {
    const xml = buildGpx("Plan <Alpha> 2026", [PLAIN_WAYPOINT]);
    expect(isWellFormedXml(xml)).toBe(true);
  });

  it("stays well-formed when plan name contains '&'", () => {
    const xml = buildGpx("Rock & Roll Drift", [PLAIN_WAYPOINT]);
    expect(isWellFormedXml(xml)).toBe(true);
  });

  it("stays well-formed when plan name contains double quotes", () => {
    const xml = buildGpx(`The "Best" Plan`, [PLAIN_WAYPOINT]);
    expect(isWellFormedXml(xml)).toBe(true);
  });

  it("stays well-formed when plan name contains single quotes / apostrophes", () => {
    const xml = buildGpx("Captain's Plan", [PLAIN_WAYPOINT]);
    expect(isWellFormedXml(xml)).toBe(true);
  });

  it("stays well-formed when plan name contains all five XML special characters", () => {
    const xml = buildGpx(`<"it's a & test">`, [PLAIN_WAYPOINT]);
    expect(isWellFormedXml(xml)).toBe(true);
  });

  it("stays well-formed with a script-injection attempt in the plan name", () => {
    const xml = buildGpx("<script>alert('xss')</script>", [PLAIN_WAYPOINT]);
    expect(isWellFormedXml(xml)).toBe(true);
  });

  // ── Waypoint <desc> escaping ──────────────────────────────────────────────

  it("stays well-formed when waypoint description contains '<' and '>'", () => {
    const xml = buildGpx("Normal Plan", [
      { ...PLAIN_WAYPOINT, descOverride: "Hour 1: depth <30 m> caution" },
    ]);
    expect(isWellFormedXml(xml)).toBe(true);
  });

  it("stays well-formed when waypoint description contains '&'", () => {
    const xml = buildGpx("Normal Plan", [
      { ...PLAIN_WAYPOINT, descOverride: "Tide & current at 1.5 kt" },
    ]);
    expect(isWellFormedXml(xml)).toBe(true);
  });

  it("stays well-formed when waypoint description contains double and single quotes", () => {
    const xml = buildGpx("Normal Plan", [
      { ...PLAIN_WAYPOINT, descOverride: `It's a "strong" drift zone` },
    ]);
    expect(isWellFormedXml(xml)).toBe(true);
  });

  it("stays well-formed when waypoint description contains all five XML special characters", () => {
    const xml = buildGpx("Normal Plan", [
      {
        ...PLAIN_WAYPOINT,
        descOverride: `<depth="30m"> it's a & test > 0`,
      },
    ]);
    expect(isWellFormedXml(xml)).toBe(true);
  });

  it("stays well-formed with multiple waypoints each having special chars in description", () => {
    const xml = buildGpx(`Fish & Chips <Plan> "2026"`, [
      { ...PLAIN_WAYPOINT, hour: 0, descOverride: "Start <A>: depth > 10 m" },
      { ...PLAIN_WAYPOINT, hour: 1, descOverride: "Mid & ebb: it's slack" },
      { ...PLAIN_WAYPOINT, hour: 2, descOverride: `End "drift": depth < 5 m` },
    ]);
    expect(isWellFormedXml(xml)).toBe(true);
  });

  // ── Negative controls: unescaped special chars break the document ─────────

  it("unescaped '<' in plan name would break XML — confirms plan-name escaping is load-bearing", () => {
    const safeXml = buildGpx("Plan <Alpha>", [PLAIN_WAYPOINT]);
    expect(isWellFormedXml(safeXml)).toBe(true);
    const brokenXml = safeXml.replace("&lt;", "<");
    expect(isWellFormedXml(brokenXml)).toBe(false);
  });

  it("unescaped '<' in waypoint description would break XML — confirms desc escaping is load-bearing", () => {
    const safeXml = buildGpx("Normal Plan", [
      { ...PLAIN_WAYPOINT, descOverride: "depth <30 m" },
    ]);
    expect(isWellFormedXml(safeXml)).toBe(true);
    const brokenXml = safeXml.replace("&lt;", "<");
    expect(isWellFormedXml(brokenXml)).toBe(false);
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it("produces an empty track segment that is still well-formed XML", () => {
    const xml = buildGpx("Empty Plan", []);
    expect(isWellFormedXml(xml)).toBe(true);
  });

  it("plan name and description with only unicode passes through and stays well-formed", () => {
    const xml = buildGpx("Pêche 🐟 • Märë Drift", [
      { ...PLAIN_WAYPOINT, descOverride: "Pêche 🐟 • Märë zone" },
    ]);
    expect(isWellFormedXml(xml)).toBe(true);
  });
});
