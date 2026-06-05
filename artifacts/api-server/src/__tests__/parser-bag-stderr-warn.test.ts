/**
 * parser-bag-stderr-warn.test.ts
 *
 * Deterministic unit test for the parseBag stderr → logger.warn path.
 *
 * The integration tests in parser-bag.test.ts rely on a real Python subprocess
 * and cannot guarantee the fixture run emits stderr.  This file mocks
 * child_process.execFile so the subprocess always returns a controlled stderr
 * payload with exit code 0, then asserts logger.warn is called with the
 * expected structured metadata.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// ── Hoisted mock state ───────────────────────────────────────────────────────
// vi.hoisted runs before vi.mock hoisting, so the references are available
// inside the factory closure below.

const { mockCustomImpl } = vi.hoisted(() => {
  const mockCustomImpl = vi.fn();
  return { mockCustomImpl };
});

// ── child_process mock ────────────────────────────────────────────────────────
// uploadParsers.ts does: const execFileAsync = promisify(execFile)
// util.promisify respects [util.promisify.custom] on the wrapped function;
// attaching our own implementation there makes execFileAsync call our mock.

vi.mock("child_process", async () => {
  const util = await import("util");
  const execFile = vi.fn() as ReturnType<typeof vi.fn> & {
    [key: symbol]: typeof mockCustomImpl;
  };
  execFile[util.promisify.custom] = mockCustomImpl;
  return { execFile };
});

// ── Subject under test (imported AFTER mock is set up) ────────────────────────
import { parseBag } from "../lib/uploadParsers.js";

// ── Test data ─────────────────────────────────────────────────────────────────
const MOCK_STDOUT = "142.005,11.005,1500\n142.006,11.006,2000\n";
const MOCK_STDERR = "UserWarning: CRS not found; falling back to bounding-box approximation.";

describe("parseBag — stderr warn forwarding (mocked subprocess)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockCustomImpl.mockReset();
  });

  it("calls logger.warn with { source: 'bag_parser.py' } and trimmed stderr when exit code is 0", async () => {
    mockCustomImpl.mockResolvedValue({ stdout: MOCK_STDOUT, stderr: MOCK_STDERR });

    const loggerModule = await import("../lib/logger.js");
    const warnSpy = vi.spyOn(loggerModule.logger, "warn");

    const pts = await parseBag(Buffer.from("fake-bag-bytes"));

    expect(pts).toHaveLength(2);
    expect(pts[0]).toMatchObject({ lon: 142.005, lat: 11.005, depth: 1500 });
    expect(pts[1]).toMatchObject({ lon: 142.006, lat: 11.006, depth: 2000 });

    expect(warnSpy).toHaveBeenCalledWith(
      { source: "bag_parser.py" },
      MOCK_STDERR,
    );
  });

  it("does NOT call logger.warn when subprocess stderr is empty", async () => {
    mockCustomImpl.mockResolvedValue({ stdout: MOCK_STDOUT, stderr: "" });

    const loggerModule = await import("../lib/logger.js");
    const warnSpy = vi.spyOn(loggerModule.logger, "warn");

    await parseBag(Buffer.from("fake-bag-bytes"));

    const bagWarnCalls = warnSpy.mock.calls.filter(
      (args) =>
        args[0] != null &&
        typeof args[0] === "object" &&
        (args[0] as Record<string, unknown>)["source"] === "bag_parser.py",
    );
    expect(bagWarnCalls).toHaveLength(0);
  });

  it("does NOT call logger.warn when subprocess stderr is whitespace-only", async () => {
    mockCustomImpl.mockResolvedValue({ stdout: MOCK_STDOUT, stderr: "   \n  " });

    const loggerModule = await import("../lib/logger.js");
    const warnSpy = vi.spyOn(loggerModule.logger, "warn");

    await parseBag(Buffer.from("fake-bag-bytes"));

    const bagWarnCalls = warnSpy.mock.calls.filter(
      (args) =>
        args[0] != null &&
        typeof args[0] === "object" &&
        (args[0] as Record<string, unknown>)["source"] === "bag_parser.py",
    );
    expect(bagWarnCalls).toHaveLength(0);
  });

  it("still resolves with valid points even when stderr is non-empty", async () => {
    mockCustomImpl.mockResolvedValue({
      stdout: "10.0,20.0,500\n-130.0,-45.0,3000\n",
      stderr: "DeprecationWarning: pyproj.Proj will be removed in a future version.",
    });

    const pts = await parseBag(Buffer.from("fake-bag-bytes"));

    expect(pts).toHaveLength(2);
    for (const p of pts) {
      expect(Number.isFinite(p.lon)).toBe(true);
      expect(Number.isFinite(p.lat)).toBe(true);
      expect(Number.isFinite(p.depth)).toBe(true);
    }
  });
});
