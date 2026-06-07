/**
 * parser-bag-stderr-warn.test.ts
 *
 * Unit tests for parseBag() CSV-parsing and error-propagation behaviour,
 * using a mocked bagWorker so no real Python subprocess is involved.
 *
 * The stderr → logger.warn path now lives inside bagWorker.ts (handled via
 * the spawn stderr event), so this file focuses on parseBag's own logic:
 *   • correctly parsing CSV returned by bagWorker.parseFile
 *   • skipping blank / malformed lines
 *   • propagating rejections from bagWorker as thrown errors
 *   • throwing when the CSV contains no valid depth points
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// ── Mock bagWorker before the subject is imported ────────────────────────────

vi.mock("../lib/bagWorker.js", () => ({
  bagWorker: {
    parseFile: vi.fn(),
    shutdown: vi.fn(),
  },
}));

// ── Subject under test ───────────────────────────────────────────────────────

import { parseBag } from "../lib/uploadParsers.js";
import { bagWorker } from "../lib/bagWorker.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockParseFile = () => vi.mocked(bagWorker.parseFile);

// ── Tests ────────────────────────────────────────────────────────────────────

describe("parseBag — CSV parsing via persistent bagWorker (mocked)", () => {
  afterEach(() => {
    mockParseFile().mockReset();
  });

  it("parses valid CSV returned by bagWorker and returns RawPoint[]", async () => {
    mockParseFile().mockResolvedValue(
      "142.005,11.005,1500\n142.006,11.006,2000\n",
    );

    const pts = await parseBag(Buffer.from("fake-bag-bytes"));

    expect(pts).toHaveLength(2);
    expect(pts[0]).toMatchObject({ lon: 142.005, lat: 11.005, depth: 1500 });
    expect(pts[1]).toMatchObject({ lon: 142.006, lat: 11.006, depth: 2000 });
  });

  it("skips blank lines in the CSV response", async () => {
    mockParseFile().mockResolvedValue(
      "\n10.0,20.0,500\n\n-130.0,-45.0,3000\n",
    );

    const pts = await parseBag(Buffer.from("fake-bag-bytes"));

    expect(pts).toHaveLength(2);
    expect(pts[0]).toMatchObject({ lon: 10.0, lat: 20.0, depth: 500 });
    expect(pts[1]).toMatchObject({ lon: -130.0, lat: -45.0, depth: 3000 });
  });

  it("skips malformed (non-numeric) lines without throwing", async () => {
    mockParseFile().mockResolvedValue(
      "not_a_number,11.0,500\n10.0,20.0,500\n",
    );

    const pts = await parseBag(Buffer.from("fake-bag-bytes"));

    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({ lon: 10.0, lat: 20.0, depth: 500 });
  });

  it("throws when bagWorker rejects — error message is preserved", async () => {
    mockParseFile().mockRejectedValue(
      new Error("BAG parse error: Not a valid BAG file: missing BAG_root group"),
    );

    await expect(parseBag(Buffer.from("not-a-bag"))).rejects.toThrow(/BAG/i);
  });

  it("throws when the CSV contains no valid depth points", async () => {
    mockParseFile().mockResolvedValue("\n\nbadline\nalso_bad\n");

    await expect(parseBag(Buffer.from("fake-bag-bytes"))).rejects.toThrow(
      /no valid depth points/i,
    );
  });

  it("handles a single valid point correctly", async () => {
    mockParseFile().mockResolvedValue("-0.5,51.5,42.0\n");

    const pts = await parseBag(Buffer.from("fake-bag-bytes"));

    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({ lon: -0.5, lat: 51.5, depth: 42.0 });
  });
});
