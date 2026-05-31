/**
 * bag-h5wasm-init-failure.test.ts
 *
 * Isolates the parseBag error path triggered when the h5wasm WASM module
 * fails to initialise (e.g. unsupported runtime, WASM disabled, CORS block).
 *
 * This path lives in a separate file so vi.mock("h5wasm") can override the
 * module registry before uploadParsers.ts loads, without affecting the main
 * real-file-integration suite which requires the real h5wasm.
 */

import { vi, describe, it, expect } from "vitest";

// vi.mock is hoisted by Vitest's transform — it runs before any import, so
// uploadParsers.ts will receive the mocked "h5wasm" module when it imports
// `ready` for the first time in this worker.
vi.mock("h5wasm", () => {
  // Attach a no-op catch so Node.js does not emit an UnhandledPromiseRejection
  // warning at module-load time.  parseBag itself awaits the promise inside a
  // try/catch, so the rejection is handled correctly during the test.
  const readyRejection = Promise.reject(
    new Error("WASM module not available in this environment"),
  );
  readyRejection.catch(() => {});
  return {
    ready: readyRejection,
    File: class MockH5wFile {},
    Group: class MockH5Group {},
    Dataset: class MockH5Dataset {},
  };
});

// Dynamic import so the module sees the mock established above.
const { parseBag } = await import("../lib/uploadParsers.js");

describe("BAG parser — h5wasm initialisation failure", () => {
  it("wraps the WASM error in a human-readable guidance message", async () => {
    const buf = Buffer.from("irrelevant — init fails before file is read");
    const err = await parseBag(buf).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;

    // Must name the underlying cause so developers can diagnose the issue.
    expect(msg).toMatch(/h5wasm initialisation failed/i);
    // Must provide a concrete conversion path so end-users are not stuck.
    expect(msg).toMatch(/gdal_translate/i);
    expect(msg).toMatch(/\.bag.*GeoTIFF|GeoTIFF.*\.bag/i);
  });
});
