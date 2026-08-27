/**
 * router-duplicate-route-guard.test.ts
 *
 * Structural guard against duplicate-route mis-merges across EVERY router
 * mounted in app.ts (via routes/index.ts) — not just datasets. A bad merge
 * that pastes a route registration twice fails here with a message naming
 * the offending router and the duplicated (method, path) pair(s).
 *
 * Keep the router list below in sync with routes/index.ts; the sync test at
 * the bottom fails with instructions when a new router is mounted there but
 * missing here.
 */

import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks (hoisted) — keep router imports free of real upstreams/DB.
// ---------------------------------------------------------------------------

vi.mock("../lib/terrain.js", async () => {
  const { createTerrainMock } = await import("./helpers/terrainMock.js");
  return createTerrainMock();
});

vi.mock("../lib/copernicusDem.js", () => ({
  fetchCopernicusDem: vi.fn(),
}));

vi.mock("../lib/substrateGrid.js", () => ({
  substrateFingerprintForDataset: vi.fn(() => "00000000"),
}));

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  return createDbMock();
});

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks) — every router mounted in routes/index.ts.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import {
  findDuplicateRoutes,
  findDuplicateRoutesDeep,
  countRoutes,
  countRoutesDeep,
  findDuplicateRoutesAcross,
  getRouterStack,
} from "./helpers/routeGuard.js";
import {
  assertApiRoutesInProductionBundle,
  DOCUMENTED_BUNDLE_ROUTE_EXCLUSIONS,
  getDocumentedApiRoutes,
  getDocumentedUploadRoutes,
} from "../../build.mjs";
import { API_DOMAINS, API_DOMAIN_KEYS } from "../routes/index.js";

import { uploadIngestionRouter } from "../domains/upload/ingestion.js";
import datasetDiscoveryRouter from "../routes/datasets-discovery.js";
import datasetTerrainRouter from "../routes/datasets-terrain.js";
import healthRouter from "../routes/health.js";
import poeRouter from "../routes/poe.js";
import markersRouter from "../routes/markers.js";
import catchesRouter from "../routes/catches.js";
import objectsRouter from "../routes/objects.js";
import settingsRouter from "../routes/settings.js";
import userDatasetsRouter from "../routes/user-datasets.js";
import foldersRouter from "../routes/folders.js";
import tidalRouter from "../routes/tidal.js";
import tidesRouter from "../routes/tides.js";
import queryRouter from "../routes/query.js";
import trailsRouter from "../routes/trails.js";
import meRouter from "../routes/me.js";
import substrateRouter from "../routes/substrate.js";
import efhRouter from "../routes/efh.js";
import intertidalSpotsRouter from "../routes/intertidal-spots.js";
import catalogDiscoveryRouter from "../routes/catalog-discovery.js";
import catalogSavesRouter from "../routes/catalog-saves.js";
import surfaceConditionsRouter from "../routes/surface-conditions.js";
import trollingPresetsRouter from "../routes/trolling-presets.js";
import trollingPresetFoldersRouter from "../routes/trolling-preset-folders.js";
import waterTemperatureRouter from "../routes/water-temperature.js";
import temperatureProfileRouter from "../routes/temperature-profile.js";
import routesRouter from "../routes/routes.js";
import weatherStationsRouter from "../routes/weather-stations.js";
import weatherStationObsRouter from "../routes/weather-station-obs.js";
import rawsStationsRouter from "../routes/raws-stations.js";
import rawsWeatherRouter from "../routes/raws-weather.js";
import nceiRouter from "../routes/ncei.js";
import searchFederatedRouter from "../routes/search-federated.js";
import adminRouter from "../routes/admin.js";
import adminUsersRouter from "../routes/admin-users.js";
import githubRouter from "../routes/github.js";
import collectionsRouter from "../routes/collections.js";
import envPackRouter from "../routes/env-pack.js";
import terrainQueryRouter from "../domains/terrain/query/index.js";
import platformCoreRouter from "../domains/platform/core-router.js";
import terrainEnrichmentRouter from "../domains/terrain/enrichment/index.js";
import catalogOrganizationRouter from "../domains/catalog-organization/index.js";
import platformGovernanceRouter from "../domains/platform/governance-router.js";
import terrainBundlesRouter from "../domains/terrain/bundles/index.js";
import { fieldDataRouter } from "../domains/upload/field-data.js";
import platformUserRoutesRouter from "../domains/platform/user-routes-router.js";
import platformIntegrationsRouter from "../domains/platform/integrations-router.js";

/** name = the routes/<name>.ts module the router comes from. */
const ROUTERS: Array<[name: string, router: unknown]> = [
  ["poe", poeRouter],
  ["datasets-discovery", datasetDiscoveryRouter],
  ["datasets-terrain", datasetTerrainRouter],
  ["upload-ingestion", uploadIngestionRouter],
  ["markers", markersRouter],
  ["catches", catchesRouter],
  ["objects", objectsRouter],
  ["catalog-organization", catalogOrganizationRouter],
  ["tidal", tidalRouter],
  ["tides", tidesRouter],
  ["query", queryRouter],
  ["trails", trailsRouter],
  ["substrate", substrateRouter],
  ["efh", efhRouter],
  ["intertidal-spots", intertidalSpotsRouter],
  ["catalog-discovery", catalogDiscoveryRouter],
  ["platform-core", platformCoreRouter],
  ["surface-conditions", surfaceConditionsRouter],
  ["trolling-presets", trollingPresetsRouter],
  ["trolling-preset-folders", trollingPresetFoldersRouter],
  ["water-temperature", waterTemperatureRouter],
  ["temperature-profile", temperatureProfileRouter],
  ["weather-stations", weatherStationsRouter],
  ["weather-station-obs", weatherStationObsRouter],
  ["raws-stations", rawsStationsRouter],
  ["raws-weather", rawsWeatherRouter],
  ["ncei", nceiRouter],
  ["search-federated", searchFederatedRouter],
  ["platform-governance", platformGovernanceRouter],
  ["platform-user-routes", platformUserRoutesRouter],
  ["platform-integrations", platformIntegrationsRouter],
  ["terrain-bundles", terrainBundlesRouter],
  ["env-pack", envPackRouter],
];

/**
 * Return route pairs from the route sources that make up the public API.
 *
 * Express does not reliably retain mount prefixes on nested router layers.
 * The two routers mounted under a public prefix are therefore represented
 * explicitly here, while all other composition boundaries use root paths.
 */
function collectRoutePairs(router: unknown, prefix = ""): string[] {
  const stack = getRouterStack(router);
  if (stack === null) {
    throw new Error("Cannot collect route pairs from a router without a layer stack");
  }

  return stack.flatMap((layer) => {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      return paths.flatMap((routePath) =>
        Object.entries(layer.route!.methods)
          .filter(([, enabled]) => enabled)
          .map(([method]) => `${method.toUpperCase()} ${prefix}${routePath}`),
      );
    }

    const nested = (layer as { handle?: unknown }).handle;
    return nested && getRouterStack(nested)
      ? collectRoutePairs(nested, prefix)
      : [];
  });
}

describe("duplicate-route mis-merge guard (all routers)", () => {
  it("terrain query composition retains both query surfaces without duplicates", () => {
    expect(countRoutesDeep(terrainQueryRouter)).toBe(
      countRoutes(poeRouter) + countRoutes(queryRouter),
    );
    expect(
      findDuplicateRoutesAcross([
        [poeRouter, "/poe"],
        [queryRouter, ""],
      ]),
    ).toEqual([]);
  });

  it("platform core composes health, settings, and account routes exactly once", () => {
    expect(countRoutesDeep(platformCoreRouter)).toBe(
      countRoutes(healthRouter) + countRoutes(settingsRouter) + countRoutes(meRouter),
    );
    expect(findDuplicateRoutes(platformCoreRouter)).toEqual([]);
  });

  it("terrain enrichment composition retains all derived-data routes without duplicates", () => {
    expect(countRoutesDeep(terrainEnrichmentRouter)).toBe(
      countRoutes(trailsRouter) +
        countRoutes(substrateRouter) +
        countRoutes(efhRouter) +
        countRoutes(intertidalSpotsRouter),
    );
    expect(
      findDuplicateRoutesAcross([
        [trailsRouter, ""],
        [substrateRouter, ""],
        [efhRouter, ""],
        [intertidalSpotsRouter, ""],
      ]),
    ).toEqual([]);
  });

  it("catalog organization composition retains all user-owned catalog routes without duplicates", () => {
    expect(countRoutesDeep(catalogOrganizationRouter)).toBe(
      countRoutes(userDatasetsRouter) +
        countRoutes(foldersRouter) +
        countRoutes(collectionsRouter) +
        countRoutes(catalogSavesRouter),
    );
    expect(
      findDuplicateRoutesAcross([
        [userDatasetsRouter, ""],
        [foldersRouter, ""],
        [collectionsRouter, ""],
        [catalogSavesRouter, ""],
      ]),
    ).toEqual([]);
  });

  it("platform governance composes administration and admin-user routes exactly once", () => {
    expect(countRoutesDeep(platformGovernanceRouter)).toBe(
      countRoutes(adminRouter) + countRoutes(adminUsersRouter),
    );
    expect(findDuplicateRoutesDeep(platformGovernanceRouter)).toEqual([]);
  });

  it("platform user routes composes saved-route CRUD exactly once", () => {
    expect(countRoutesDeep(platformUserRoutesRouter)).toBe(
      countRoutes(routesRouter),
    );
    expect(findDuplicateRoutesDeep(platformUserRoutesRouter)).toEqual([]);
  });

  it("platform integrations preserves the /github prefix exactly once", () => {
    expect(countRoutesDeep(platformIntegrationsRouter)).toBe(
      countRoutes(githubRouter),
    );
    expect(findDuplicateRoutesAcross([
      [githubRouter, "/github"],
    ])).toEqual([]);
    expect(findDuplicateRoutesDeep(platformIntegrationsRouter)).toEqual([]);
  });

  it.each(ROUTERS)("routes/%s.ts registers every (method, path) pair at most once", (name, router) => {
    expect(
      countRoutesDeep(router),
      `routes/${name}.ts registered zero routes — guard would pass vacuously; is the export still a Router?`,
    ).toBeGreaterThan(0);

    const duplicates = findDuplicateRoutesDeep(router);
    expect(
      duplicates,
      `Duplicate route registration(s) on the "${name}" router — this is the signature of a ` +
        `mis-merge in src/routes/${name}.ts. Duplicated: ${duplicates.join(", ")}. ` +
        `Delete the extra registration(s); keep exactly one handler per (method, path).`,
    ).toEqual([]);
  });

  it("covers every router mounted in routes/index.ts", () => {
    const indexSrc = fs.readFileSync(
      path.join(__dirname, "..", "routes", "index.ts"),
      "utf8",
    );
    const mounted = [...indexSrc.matchAll(/from\s+["']\.\.\/domains\/([^/]+)\/index\.js["']/g)]
      .map((m) => m[1])
      .filter(Boolean);
    const missing = mounted.filter(
      (n) => !API_DOMAIN_KEYS.includes(n as (typeof API_DOMAIN_KEYS)[number]),
    );
    expect(
      missing,
      `Domain module(s) imported in routes/index.ts but missing from the composition ` +
        `inventory: ${missing.join(", ")}. Add them to API_DOMAINS.`,
    ).toEqual([]);
    expect(mounted.sort()).toEqual([...API_DOMAIN_KEYS].sort());
  });

  it("upload field-data composition contains each endpoint exactly once", () => {
    expect(countRoutesDeep(fieldDataRouter)).toBe(
      [markersRouter, catchesRouter, objectsRouter].reduce(
        (total, router) => total + countRoutes(router),
        0,
      ),
    );
    expect(findDuplicateRoutesDeep(fieldDataRouter)).toEqual([]);
  });

  it("dataset capability composition retains the complete route inventory exactly once", async () => {
    const { datasetDomain } = await import("../domains/datasets/index.js");
    expect(countRoutes(datasetDiscoveryRouter)).toBe(2);
    expect(countRoutes(datasetTerrainRouter)).toBe(7);
    expect(countRoutes(uploadIngestionRouter)).toBe(11);
    expect(countRoutesDeep(datasetDomain.router)).toBe(
      countRoutes(datasetDiscoveryRouter) + countRoutes(datasetTerrainRouter),
    );
    expect(findDuplicateRoutesDeep(datasetDomain.router)).toEqual([]);
    expect(findDuplicateRoutesAcross([
      [datasetDiscoveryRouter, ""],
      [datasetTerrainRouter, ""],
      [uploadIngestionRouter, ""],
    ])).toEqual([]);
  });

  it("keeps the documented dataset endpoint inventory assigned to one capability", () => {
    const routePairs = (router: unknown) => (getRouterStack(router) ?? [])
      .flatMap((layer) => {
        if (!layer.route) return [];
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        return paths.flatMap((routePath) => Object.entries(layer.route!.methods)
          .filter(([, enabled]) => enabled)
          .map(([method]) => `${method.toUpperCase()} ${routePath}`));
      })
      .sort();

    expect(routePairs(datasetDiscoveryRouter)).toEqual([
      "DELETE /datasets/presets/:id",
      "GET /datasets",
    ]);
    expect(routePairs(datasetTerrainRouter)).toEqual([
      "GET /datasets/:id/overview",
      "GET /datasets/:id/preview",
      "GET /datasets/:id/terrain",
      "GET /datasets/:id/zones",
      "GET /terrain/download",
      "GET /terrain/download/info",
      "GET /terrain/land",
    ]);
    expect(routePairs(uploadIngestionRouter)).toEqual([
      "GET /datasets/upload/chunk/status/:uploadId",
      "GET /datasets/upload/gcs-job-status",
      "GET /datasets/upload/gcs-jobs",
      "GET /datasets/upload/jobs/:jobId",
      "POST /datasets/raster-commit",
      "POST /datasets/raster-extract",
      "POST /datasets/upload",
      "POST /datasets/upload/chunk",
      "POST /datasets/upload/chunk/finalize",
      "POST /datasets/upload/request-gcs-url",
      "POST /datasets/upload/start",
    ]);
  });

  it("keeps the documented upload inventory aligned with the source router", () => {
    const yamlPath = path.resolve(__dirname, "../../../../lib/api-spec/openapi.yaml");
    const documented = getDocumentedUploadRoutes(fs.readFileSync(yamlPath, "utf8"))
      .map((route) =>
        route.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, ":$1"),
      );

    const routePairs = (router: unknown) => (getRouterStack(router) ?? [])
      .flatMap((layer) => {
        if (!layer.route) return [];
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        return paths.flatMap((routePath) => Object.entries(layer.route!.methods)
          .filter(([, enabled]) => enabled)
          .map(([method]) => `${method.toUpperCase()} ${routePath}`));
      })
      .sort();

    expect(routePairs(uploadIngestionRouter)).toEqual(documented);
  });

  it("keeps every documented API route in the composed source inventory", () => {
    const yamlPath = path.resolve(__dirname, "../../../../lib/api-spec/openapi.yaml");
    const documented = new Set(getDocumentedApiRoutes(fs.readFileSync(yamlPath, "utf8")));
    const registered = new Set(
      ROUTERS
        .filter(([name]) => name !== "platform-integrations")
        .flatMap(([name, router]) =>
          collectRoutePairs(router, name === "poe" ? "/poe" : ""),
        )
        .concat(collectRoutePairs(githubRouter, "/github"))
        .map((route) => {
          const separator = route.indexOf(" ");
          const method = route.slice(0, separator);
          const expressPath = route.slice(separator + 1);
          const openApiPath = expressPath
            .replace(/\*([a-zA-Z_][a-zA-Z0-9_]*)/g, "{$1}")
            .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, "{$1}");
          return `${method} ${openApiPath}`;
        }),
    );

    const protectedDocumented = new Set(
      [...documented].filter(
        (route) => !Object.hasOwn(DOCUMENTED_BUNDLE_ROUTE_EXCLUSIONS, route),
      ),
    );
    const missing = [...protectedDocumented]
      .filter((route) => !registered.has(route))
      .sort();

    for (const [route, reason] of Object.entries(DOCUMENTED_BUNDLE_ROUTE_EXCLUSIONS)) {
      expect(reason.trim(), `Documented route exclusion ${route} needs a reason`).not.toBe("");
      expect(documented.has(route), `Stale documented route exclusion: ${route}`).toBe(true);
      expect(registered.has(route), `Route exclusion is no longer absent from Express: ${route}`)
        .toBe(false);
    }
    expect(
      missing,
      `Documented API route(s) missing from the composed source inventory: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("reports the missing method/path when a documented non-upload route is absent", () => {
    expect(() =>
      assertApiRoutesInProductionBundle(
        'router.get("/healthz")',
        ["GET /healthz", "POST /query"],
      ),
    ).toThrow("POST /query");
  });

  it.each(API_DOMAINS)("$name domain is composed", (domain) => {
    expect(countRoutesDeep(domain.router)).toBeGreaterThan(0);
  });

  it("composed API router contains each endpoint exactly once", async () => {
    const { default: apiRouter } = await import("../routes/index.js");
    expect(countRoutesDeep(apiRouter)).toBeGreaterThan(0);
    expect(countRoutesDeep(apiRouter)).toBe(
      ROUTERS.reduce(
        (total, [name, router]) =>
        total +
            (name === "platform-governance" ||
              name === "platform-core" ||
              name === "platform-user-routes" ||
              name === "platform-integrations" ||
              name === "catalog-organization"
              ? countRoutesDeep(router)
              : countRoutes(router)),
        0,
      ),
    );
    expect(
      findDuplicateRoutesAcross(
        ROUTERS.map(([name, router]) => [
          router,
          name === "poe" ? "/poe" : name === "platform-integrations" ? "/github" : "",
        ]),
      ),
    ).toEqual([]);
  });
});
