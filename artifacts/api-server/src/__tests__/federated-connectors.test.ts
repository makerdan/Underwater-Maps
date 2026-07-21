/**
 * federated-connectors.test.ts — mapping/importability tests for the
 * federated search connectors. Upstream HTTP calls are stubbed via
 * vi.stubGlobal("fetch", …); importability must flow exclusively through
 * deriveCatalogFetchStrategy (via deriveImportability).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { deriveImportability } from "../lib/federatedSearch/importable.js";
import { scienceBaseConnector } from "../lib/federatedSearch/connectors/scienceBase.js";
import { usgs3depCoverageConnector } from "../lib/federatedSearch/connectors/usgs3depCoverage.js";
import {
  makeArcgisPortalConnector,
  STATE_PORTAL_CONFIGS,
} from "../lib/federatedSearch/connectors/arcgisPortals.js";
import { githubAllowlistConnector, GITHUB_ALLOWLIST_USERS } from "../lib/federatedSearch/connectors/githubAllowlist.js";

const signal = new AbortController().signal;

function stubFetchJson(payload: unknown, ok = true, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({
    ok,
    status,
    json: async () => payload,
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// deriveImportability — single source of truth
// ---------------------------------------------------------------------------

describe("deriveImportability", () => {
  it("NCEI DEM Global Mosaic WCS endpoint is importable as ncei-wcs", () => {
    const r = deriveImportability({
      id: "ncei-portal-x",
      endpointUrl:
        "https://gis.ngdc.noaa.gov/arcgis/services/DEM_mosaics/DEM_global_mosaic/ImageServer/WCSServer",
      coverageBbox: { minLon: -136, minLat: 54, maxLon: -130, maxLat: 60 },
    });
    expect(r.importable).toBe(true);
    expect(r.importKind).toBe("ncei-wcs");
  });

  it("null endpoint is link-only", () => {
    const r = deriveImportability({ id: "x", endpointUrl: null, coverageBbox: null });
    expect(r).toEqual({ importable: false, importKind: null });
  });

  it("github.com URLs never derive a strategy (link-only)", () => {
    const r = deriveImportability({
      id: "github-noaa-ocs-hydrography/repo",
      endpointUrl: "https://github.com/noaa-ocs-hydrography/repo",
      coverageBbox: null,
    });
    expect(r.importable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ScienceBase connector
// ---------------------------------------------------------------------------

describe("scienceBaseConnector", () => {
  it("maps items with bbox, link, and summary", async () => {
    stubFetchJson({
      items: [
        {
          id: "abc123",
          title: "Lake Powell Bathymetry Survey",
          summary: "Multibeam survey of Lake Powell",
          link: { url: "https://www.sciencebase.gov/catalog/item/abc123" },
          spatial: { boundingBox: { minX: -111.5, maxX: -110.5, minY: 36.9, maxY: 37.9 } },
          webLinks: [{ uri: "https://example.org/data.zip" }],
        },
        { id: "no-title" }, // dropped — no title
      ],
    });
    const out = await scienceBaseConnector.search("lake powell", null, signal);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "usgs-sciencebase:abc123",
      sourceId: "usgs-sciencebase",
      sourceLabel: "USGS ScienceBase",
      name: "Lake Powell Bathymetry Survey",
      description: "Multibeam survey of Lake Powell",
      url: "https://www.sciencebase.gov/catalog/item/abc123",
      coverageBbox: { minLon: -111.5, minLat: 36.9, maxLon: -110.5, maxLat: 37.9 },
      importable: false,
      importKind: null,
    });
  });

  it("drops items whose bbox does not intersect the viewport bbox, keeps bbox-less items", async () => {
    stubFetchJson({
      items: [
        {
          id: "far",
          title: "Far away",
          spatial: { boundingBox: { minX: 10, maxX: 11, minY: 50, maxY: 51 } },
        },
        { id: "unknown", title: "No bbox item" },
      ],
    });
    const out = await scienceBaseConnector.search(
      "bathymetry",
      { minLon: -120, minLat: 38, maxLon: -119, maxLat: 39 },
      signal,
    );
    expect(out.map((r) => r.id)).toEqual(["usgs-sciencebase:unknown"]);
  });

  it("throws on upstream HTTP error (runner turns it into a source status)", async () => {
    stubFetchJson({}, false, 503);
    await expect(scienceBaseConnector.search("x", null, signal)).rejects.toThrow(/503/);
  });
});

// ---------------------------------------------------------------------------
// USGS 3DEP coverage connector
// ---------------------------------------------------------------------------

describe("usgs3depCoverageConnector", () => {
  it("returns one importable result when bbox center is in CONUS", async () => {
    // Central Texas — inside CONUS but outside every bundled-terrain footprint.
    const out = await usgs3depCoverageConnector.search(
      "",
      { minLon: -98.2, minLat: 31.0, maxLon: -97.8, maxLat: 31.4 },
      signal,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      sourceId: "usgs-3dep",
      importable: true,
      importKind: "usgs-3dep",
    });
  });

  it("returns nothing for a bbox outside CONUS", async () => {
    const out = await usgs3depCoverageConnector.search(
      "",
      { minLon: 5, minLat: 45, maxLon: 6, maxLat: 46 },
      signal,
    );
    expect(out).toEqual([]);
  });

  it("returns a CONUS-wide result for elevation-flavoured queries without bbox", async () => {
    const out = await usgs3depCoverageConnector.search("lidar coverage", null, signal);
    expect(out).toHaveLength(1);
    expect(out[0]!.importable).toBe(true);
  });

  it("returns nothing for unrelated queries without bbox", async () => {
    const out = await usgs3depCoverageConnector.search("fishing spots", null, signal);
    expect(out).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ArcGIS portal connector
// ---------------------------------------------------------------------------

describe("makeArcgisPortalConnector (ago mode)", () => {
  const connector = makeArcgisPortalConnector({
    mode: "ago",
    id: "portal-nysdec",
    label: "NYSDEC (New York)",
    orgId: "DZHaqZm9cxOD4CWM",
  });

  it("queries AGO with orgid qualifier and maps data-type items", async () => {
    const fetchSpy = stubFetchJson({
      results: [
        {
          id: "item1",
          title: "Finger Lakes Bathymetry",
          snippet: "Depth contours for the Finger Lakes",
          type: "Feature Service",
          url: "https://services6.arcgis.com/DZHaqZm9cxOD4CWM/arcgis/rest/services/FL_bathy/FeatureServer",
          extent: [[-77.5, 42.3], [-76.3, 43.0]],
        },
        { id: "item2", title: "Some Web Map", type: "Web Map" }, // dropped
      ],
    });
    const out = await connector.search("bathymetry", null, signal);
    const calledUrl = String(fetchSpy.mock.calls[0]![0]);
    expect(calledUrl).toContain("orgid%3ADZHaqZm9cxOD4CWM");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "portal-nysdec:item1",
      sourceId: "portal-nysdec",
      sourceLabel: "NYSDEC (New York)",
      name: "Finger Lakes Bathymetry",
      url: "https://www.arcgis.com/home/item.html?id=item1",
      coverageBbox: { minLon: -77.5, minLat: 42.3, maxLon: -76.3, maxLat: 43.0 },
    });
  });

  it("passes the bbox param through to AGO", async () => {
    const fetchSpy = stubFetchJson({ results: [] });
    await connector.search("bathymetry", { minLon: -77, minLat: 42, maxLon: -76, maxLat: 43 }, signal);
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("bbox=-77%2C42%2C-76%2C43");
  });

  it("throws when AGO returns an error payload", async () => {
    stubFetchJson({ error: { message: "org not found" } });
    await expect(connector.search("x", null, signal)).rejects.toThrow(/org not found/);
  });
});

describe("makeArcgisPortalConnector (static-services mode — MN DNR)", () => {
  const mnConfig = STATE_PORTAL_CONFIGS.find((c) => c.id === "portal-mndnr")!;
  const connector = makeArcgisPortalConnector(mnConfig);

  it("returns the MN lake bathymetry service for a matching query — importable via mn-dnr strategy", async () => {
    const out = await connector.search("minnesota lake bathymetry", null, signal);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      sourceId: "portal-mndnr",
      importable: true,
      importKind: "arcgis-rest",
    });
  });

  it("filters by bbox intersection", async () => {
    const out = await connector.search(
      "bathymetry",
      { minLon: -80, minLat: 25, maxLon: -79, maxLat: 26 }, // Florida
      signal,
    );
    expect(out).toEqual([]);
  });

  it("returns nothing for unrelated queries", async () => {
    const out = await connector.search("texas reservoirs", null, signal);
    expect(out).toEqual([]);
  });
});

describe("STATE_PORTAL_CONFIGS", () => {
  it("seeds NYSDEC, MN DNR and at least 3 more portals", () => {
    const ids = STATE_PORTAL_CONFIGS.map((c) => c.id);
    expect(ids).toContain("portal-nysdec");
    expect(ids).toContain("portal-mndnr");
    expect(ids.length).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// GitHub allowlist connector
// ---------------------------------------------------------------------------

describe("githubAllowlistConnector", () => {
  it("constrains the search to allowlisted users and maps repos as link-only", async () => {
    const fetchSpy = stubFetchJson({
      items: [
        {
          id: 1,
          full_name: "noaa-ocs-hydrography/nbs-data",
          description: "National Bathymetric Source data",
          html_url: "https://github.com/noaa-ocs-hydrography/nbs-data",
        },
      ],
    });
    const out = await githubAllowlistConnector.search("bathymetry", null, signal);
    const calledUrl = decodeURIComponent(String(fetchSpy.mock.calls[0]![0]));
    for (const user of GITHUB_ALLOWLIST_USERS) {
      expect(calledUrl).toContain(`user:${user}`);
    }
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "github-allowlist:noaa-ocs-hydrography/nbs-data",
      sourceLabel: "GitHub (open bathymetry repos)",
      url: "https://github.com/noaa-ocs-hydrography/nbs-data",
      importable: false,
      importKind: null,
    });
  });

  it("throws on rate limit (403) so the runner reports a non-fatal error", async () => {
    stubFetchJson({ message: "API rate limit exceeded" }, false, 403);
    await expect(githubAllowlistConnector.search("x", null, signal)).rejects.toThrow(/403/);
  });
});
