import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  parseGeoTiff,
  parseNetCdf,
  parseLasLaz,
  parseBag,
  parseGpxTerrain,
  parseNmea,
  parseUploadedFile,
  type RawPoint,
} from "../lib/uploadParsers.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dir, "fixtures");

let tifBuf: Buffer;
let ncBuf: Buffer;
let las12Buf: Buffer;
let las14Buf: Buffer;
let bagBuf: Buffer;
let gpxBuf: Buffer;
let nmeaBuf: Buffer;

beforeAll(async () => {
  [tifBuf, ncBuf, las12Buf, las14Buf, bagBuf, gpxBuf, nmeaBuf] = await Promise.all([
    readFile(join(FIXTURE_DIR, "survey.tif")),
    readFile(join(FIXTURE_DIR, "survey.nc")),
    readFile(join(FIXTURE_DIR, "survey_1_2.las")),
    readFile(join(FIXTURE_DIR, "survey_1_4.las")),
    readFile(join(FIXTURE_DIR, "survey.bag")),
    readFile(join(FIXTURE_DIR, "survey.gpx")),
    readFile(join(FIXTURE_DIR, "survey.nmea")),
  ]);
});

describe("Cross-format consistency", () => {
  it("all seven formats produce finite, positive depth values", async () => {
    const [tifPts, las12Pts, las14Pts, bagPts] = await Promise.all([
      parseGeoTiff(tifBuf),
      parseLasLaz(las12Buf, "survey_1_2.las"),
      parseLasLaz(las14Buf, "survey_1_4.las"),
      parseBag(bagBuf),
    ]);
    const ncPts = parseNetCdf(ncBuf);
    const gpxPts = parseGpxTerrain(gpxBuf.toString("utf8"));
    const nmeaPts = parseNmea(nmeaBuf.toString("utf8"));

    for (const pts of [tifPts, ncPts, las12Pts, las14Pts, bagPts, gpxPts, nmeaPts]) {
      expect(pts.length).toBeGreaterThan(0);
      for (const p of pts) {
        expect(p.depth).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(p.depth)).toBe(true);
      }
    }
  });

  it("parseUploadedFile handles all seven fixture files without throwing", async () => {
    const results = await Promise.allSettled([
      parseUploadedFile(tifBuf, "survey.tif"),
      Promise.resolve(parseUploadedFile(ncBuf, "survey.nc")),
      parseUploadedFile(las12Buf, "survey_1_2.las"),
      parseUploadedFile(las14Buf, "survey_1_4.las"),
      parseUploadedFile(bagBuf, "survey.bag"),
      parseUploadedFile(gpxBuf, "survey.gpx"),
      parseUploadedFile(nmeaBuf, "survey.nmea"),
    ]);

    for (const r of results) {
      expect(r.status).toBe("fulfilled");
    }

    const pointCounts = results
      .filter((r): r is PromiseFulfilledResult<RawPoint[]> => r.status === "fulfilled")
      .map((r) => r.value.length);

    for (const count of pointCounts) {
      expect(count).toBeGreaterThanOrEqual(10);
    }
  });
});
