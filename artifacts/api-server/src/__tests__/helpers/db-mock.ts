/**
 * Shared @workspace/db mock factory for upload-related tests.
 *
 * Usage inside a vi.mock() factory:
 *
 *   vi.mock("@workspace/db", async () => {
 *     const { createDbMock } = await import("./__tests__/helpers/db-mock.js");
 *     return createDbMock();
 *   });
 *
 * To override the `db` object (e.g. to expose spies for assertions), pass
 * a partial `db` override:
 *
 *   vi.mock("@workspace/db", async () => {
 *     const { createDbMock } = await import("./__tests__/helpers/db-mock.js");
 *     return createDbMock({ db: { insert: myInsertSpy, select: mySelectSpy } });
 *   });
 *
 * All table stubs mirror the real @workspace/db schema export names so Vitest
 * never emits "No X export is defined on the @workspace/db mock" warnings.
 */

import { vi, type MockInstance } from "vitest";

export type DbMockDb = {
  select: MockInstance;
  insert: MockInstance;
  update: MockInstance;
  delete: MockInstance;
  transaction: <T>(cb: (tx: unknown) => Promise<T>) => Promise<T>;
};

export interface DbMockOptions {
  db?: Partial<DbMockDb>;
  pool?: { end: MockInstance };
}

/** Stub shape used for every table — column names as plain strings. */
const customDatasetsTableStub = {
  id: "id",
  userId: "userId",
  name: "name",
  minDepth: "minDepth",
  maxDepth: "maxDepth",
  terrainJson: "terrainJson",
  overviewJson: "overviewJson",
  folderId: "folderId",
  createdAt: "createdAt",
};

const userSettingsTableStub = {
  userId: "userId",
  settings: "settings",
};

const uploadJobsTableStub = {
  id: "id",
  userId: "userId",
  status: "status",
  progress: "progress",
  error: "error",
  datasetId: "datasetId",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
};

const disabledPresetsTableStub = {
  id: "id",
  disabledAt: "disabledAt",
};

const userCatalogSavesTableStub = {
  id: "id",
  userId: "userId",
  catalogId: "catalogId",
  status: "status",
  requestedAt: "requestedAt",
  readyAt: "readyAt",
  cacheKey: "cacheKey",
  errorMessage: "errorMessage",
  folderId: "folderId",
  datasetId: "datasetId",
};

const markersTableStub = {
  id: "id",
  datasetId: "datasetId",
  lon: "lon",
  lat: "lat",
  depth: "depth",
  type: "type",
  label: "label",
  notes: "notes",
  userId: "userId",
  createdAt: "createdAt",
};

const datasetFoldersTableStub = {
  id: "id",
  userId: "userId",
  parentId: "parentId",
  name: "name",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
};

const gpsTrailsTableStub = {
  id: "id",
  userId: "userId",
  datasetId: "datasetId",
  name: "name",
  colour: "colour",
  startedAt: "startedAt",
  endedAt: "endedAt",
};

const datasetCatalogTableStub = {
  id: "id",
  name: "name",
  sourceAgency: "sourceAgency",
  dataType: "dataType",
  resolutionMMin: "resolutionMMin",
  resolutionMMax: "resolutionMMax",
  coverageBbox: "coverageBbox",
  endpointUrl: "endpointUrl",
  accessNotes: "accessNotes",
  description: "description",
  keywords: "keywords",
  lastUpdated: "lastUpdated",
  waterType: "waterType",
  createdAt: "createdAt",
};

const trollingPresetsTableStub = {
  id: "id",
  userId: "userId",
  name: "name",
  headingDeg: "headingDeg",
  speedKnots: "speedKnots",
  startLat: "startLat",
  startLon: "startLon",
  waypoints: "waypoints",
  sortOrder: "sortOrder",
};

const trollingPresetFoldersTableStub = {
  id: "id",
  userId: "userId",
  name: "name",
  sortOrder: "sortOrder",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
};

const routesTableStub = {
  id: "id",
  userId: "userId",
  datasetId: "datasetId",
  name: "name",
};

const weatherStationCacheTableStub = {
  id: "id",
  stationId: "stationId",
  data: "data",
  fetchedAt: "fetchedAt",
};

const rawsObservationCacheTableStub = {
  id: "id",
  stationId: "stationId",
  data: "data",
  fetchedAt: "fetchedAt",
};

const poeUsageLogTableStub = {
  id: "id",
  userId: "userId",
  model: "model",
  endpoint: "endpoint",
  promptTokens: "promptTokens",
  completionTokens: "completionTokens",
  totalTokens: "totalTokens",
  estimatedPoints: "estimatedPoints",
  createdAt: "createdAt",
};

const rateLimitEventsTableStub = {
  id: "id",
  userId: "userId",
  route: "route",
  createdAt: "createdAt",
};

const uploadCalibrationTableStub = {
  extension: "extension",
  durations: "durations",
  updatedAt: "updatedAt",
};

function buildDefaultDb(): DbMockDb {
  const whereMock = vi.fn().mockResolvedValue([]);
  const fromMock = vi.fn().mockReturnValue({ where: whereMock });

  const returningMock = vi.fn().mockResolvedValue([]);
  const onConflictDoUpdateMock = vi.fn().mockResolvedValue([]);
  const onConflictDoNothingMock = vi.fn().mockResolvedValue([]);
  const valuesMock = vi.fn().mockReturnValue({
    returning: returningMock,
    onConflictDoUpdate: onConflictDoUpdateMock,
    onConflictDoNothing: onConflictDoNothingMock,
  });

  const updateReturningMock = vi.fn().mockResolvedValue([]);
  const updateWhereMock = vi.fn().mockImplementation(() => ({
    returning: updateReturningMock,
    then: (resolve: (v: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
    catch: (reject: (e: unknown) => unknown) => Promise.resolve([]).catch(reject),
    finally: (fn: () => void) => Promise.resolve([]).finally(fn),
  }));
  const setMock = vi.fn().mockReturnValue({ where: updateWhereMock });

  const deleteReturningMock = vi.fn().mockResolvedValue([]);
  const deleteWhereMock = vi.fn().mockReturnValue({ returning: deleteReturningMock });

  return {
    select: vi.fn().mockReturnValue({ from: fromMock }),
    insert: vi.fn().mockReturnValue({ values: valuesMock }),
    update: vi.fn().mockReturnValue({ set: setMock }),
    delete: vi.fn().mockReturnValue({ where: deleteWhereMock }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
  };
}

/**
 * Returns a complete @workspace/db mock module with every exported table stub
 * present. Pass `options.db` to override specific `db.*` methods (e.g. to
 * expose spies for per-test assertions).
 */
export function createDbMock(options: DbMockOptions = {}) {
  const defaultDb = buildDefaultDb();

  return {
    db: { ...defaultDb, ...options.db },
    pool: options.pool ?? { end: vi.fn() },

    customDatasetsTable: customDatasetsTableStub,
    userSettingsTable: userSettingsTableStub,
    uploadJobsTable: uploadJobsTableStub,
    disabledPresetsTable: disabledPresetsTableStub,
    userCatalogSavesTable: userCatalogSavesTableStub,
    markersTable: markersTableStub,
    datasetFoldersTable: datasetFoldersTableStub,
    gpsTrailsTable: gpsTrailsTableStub,
    datasetCatalogTable: datasetCatalogTableStub,
    trollingPresetsTable: trollingPresetsTableStub,
    trollingPresetFoldersTable: trollingPresetFoldersTableStub,
    routesTable: routesTableStub,
    weatherStationCacheTable: weatherStationCacheTableStub,
    rawsObservationCacheTable: rawsObservationCacheTableStub,
    poeUsageLogTable: poeUsageLogTableStub,
    rateLimitEventsTable: rateLimitEventsTableStub,
    uploadCalibrationTable: uploadCalibrationTableStub,
  };
}
