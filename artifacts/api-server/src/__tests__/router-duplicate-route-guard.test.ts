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
  countRoutes,
  countRoutesDeep,
  findDuplicateRoutesAcross,
  findDuplicateRoutesDeep,
} from "./helpers/routeGuard.js";
import { API_DOMAINS, API_DOMAIN_KEYS } from "../routes/index.js";

import { uploadIngestionRouter } from "../domains/upload/ingestion.js";
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
import adminRouter from "../routes/admin.js";
import adminUsersRouter from "../routes/admin-users.js";
import githubRouter from "../routes/github.js";
import collectionsRouter from "../routes/collections.js";
import terrainBundlesRouter from "../routes/terrain-bundles.js";
import envPackRouter from "../routes/env-pack.js";
import terrainQueryRouter from "../domains/terrain/query/index.js";
import platformCoreRouter from "../domains/platform/core-router.js";
import terrainEnrichmentRouter from "../domains/terrain/enrichment/index.js";
import catalogOrganizationRouter from "../domains/catalog-organization/index.js";

/** name = the routes/<name>.ts module the router comes from. */
const ROUTERS: Array<[name: string, router: unknown]> = [
  ["health", healthRouter],
  ["poe", poeRouter],
  ["upload-ingestion", uploadIngestionRouter],
  ["markers", markersRouter],
  ["catches", catchesRouter],
  ["objects", objectsRouter],
  ["settings", settingsRouter],
  ["catalog-organization", catalogOrganizationRouter],
  ["tidal", tidalRouter],
  ["tides", tidesRouter],
  ["query", queryRouter],
  ["me", meRouter],
  ["trails", trailsRouter],
  ["substrate", substrateRouter],
  ["efh", efhRouter],
  ["intertidal-spots", intertidalSpotsRouter],
  ["catalog-discovery", catalogDiscoveryRouter],
  ["surface-conditions", surfaceConditionsRouter],
  ["trolling-presets", trollingPresetsRouter],
  ["trolling-preset-folders", trollingPresetFoldersRouter],
  ["water-temperature", waterTemperatureRouter],
  ["temperature-profile", temperatureProfileRouter],
  ["routes", routesRouter],
  ["weather-stations", weatherStationsRouter],
  ["weather-station-obs", weatherStationObsRouter],
  ["raws-stations", rawsStationsRouter],
  ["raws-weather", rawsWeatherRouter],
  ["admin", adminRouter],
  ["admin-users", adminUsersRouter],
  ["github", githubRouter],
  ["terrain-bundles", terrainBundlesRouter],
  ["env-pack", envPackRouter],
];
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

  it.each(ROUTERS)("routes/%s.ts registers every (method, path) pair at most once", (name, router) => {
    expect(
      name === "catalog-organization" ? countRoutesDeep(router) : countRoutes(router),
      `routes/${name}.ts registered zero routes — guard would pass vacuously; is the export still a Router?`,
    ).toBeGreaterThan(0);

    const duplicates = name === "catalog-discovery" || name === "catalog-organization"
      ? findDuplicateRoutesDeep(router)
      : findDuplicateRoutes(router);
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
          (name === "catalog-discovery" || name === "catalog-organization"
            ? countRoutesDeep(router)
            : countRoutes(router)),
        0,
      ),
    );
    expect(
      findDuplicateRoutesAcross(
        ROUTERS.map(([name, router]) => [
          router,
          name === "poe" ? "/poe" : name === "github" ? "/github" : "",
        ]),
      ),
    ).toEqual([]);
  });
});
