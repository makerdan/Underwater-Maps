/**
 * tarDetect.test.ts — unit tests for the tar detection and extraction helpers.
 *
 * Verifies:
 *  - isTarBuffer: correctly identifies POSIX tar magic bytes at offset 257
 *  - isTarBuffer: rejects non-tar buffers (CSV, gzip, random bytes, too-short)
 *  - isTarFile: reads magic from a file on disk correctly
 *  - extractTarBuffer: extracts entries to a directory
 *  - extractTarFile: extracts entries from a file to a directory
 *  - Non-tar gz round-trip: a plain csv.gz is NOT detected as tar
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as zlib from "zlib";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as tar from "tar";
import {
  isTarBuffer,
  isTarFile,
  extractTarBuffer,
  extractTarFile,
} from "../lib/tarDetect.js";

// ---------------------------------------------------------------------------
// Helpers — build minimal tar archives in memory
// ---------------------------------------------------------------------------

/** Create a gzip-compressed tar archive containing one text file in memory. */
async function makeTarGz(
  entries: Array<{ name: string; content: string }>,
): Promise<Buffer> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tartest-"));
  const tarPath = path.join(tmpDir, "test.tar");

  try {
    for (const e of entries) {
      await fs.promises.writeFile(path.join(tmpDir, e.name), e.content, "utf8");
    }

    await tar.c(
      { file: tarPath, cwd: tmpDir },
      entries.map((e) => e.name),
    );

    const tarBuf = await fs.promises.readFile(tarPath);
    return zlib.gzipSync(tarBuf);
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

/** Create a raw (uncompressed) tar buffer containing one text file. */
async function makeTarBuffer(
  entries: Array<{ name: string; content: string }>,
): Promise<Buffer> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tartest-"));
  const tarPath = path.join(tmpDir, "test.tar");

  try {
    for (const e of entries) {
      await fs.promises.writeFile(path.join(tmpDir, e.name), e.content, "utf8");
    }
    await tar.c(
      { file: tarPath, cwd: tmpDir },
      entries.map((e) => e.name),
    );
    return fs.promises.readFile(tarPath);
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Fixtures — generated once before all tests
// ---------------------------------------------------------------------------

let tarBuf: Buffer;
let tarGzBuf: Buffer;
let tmpExtractBase: string;

beforeAll(async () => {
  tarBuf = await makeTarBuffer([{ name: "survey.xyz", content: "-136.0 58.5 50\n" }]);
  tarGzBuf = await makeTarGz([
    { name: "survey.xyz", content: "-136.0 58.5 50\n" },
    { name: "readme.txt", content: "NOAA smooth sheet\n" },
  ]);
  tmpExtractBase = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tartest-extract-"));
});

afterAll(async () => {
  await fs.promises.rm(tmpExtractBase, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// isTarBuffer
// ---------------------------------------------------------------------------

describe("isTarBuffer — detection", () => {
  it("identifies a POSIX tar buffer by ustar magic at offset 257", () => {
    expect(isTarBuffer(tarBuf)).toBe(true);
  });

  it("rejects a gzip buffer (not a tar)", () => {
    const gz = zlib.gzipSync(Buffer.from("not a tar"));
    expect(isTarBuffer(gz)).toBe(false);
  });

  it("rejects a plain CSV buffer", () => {
    const csv = Buffer.from("lon,lat,depth\n-136.0,58.5,50\n");
    expect(isTarBuffer(csv)).toBe(false);
  });

  it("rejects a buffer shorter than 262 bytes", () => {
    expect(isTarBuffer(Buffer.alloc(100))).toBe(false);
  });

  it("rejects all-zero 512-byte buffer (no ustar magic)", () => {
    expect(isTarBuffer(Buffer.alloc(512, 0))).toBe(false);
  });

  it("rejects a buffer with 'ustar' at wrong offset", () => {
    const buf = Buffer.alloc(512, 0);
    buf.write("ustar", 100, "ascii");
    expect(isTarBuffer(buf)).toBe(false);
  });

  it("accepts a tar buffer with 'ustar' written at exactly offset 257", () => {
    const buf = Buffer.alloc(512, 0);
    buf.write("ustar", 257, "ascii");
    expect(isTarBuffer(buf)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isTarFile
// ---------------------------------------------------------------------------

describe("isTarFile — file on disk", () => {
  it("returns true for a .tar file on disk", async () => {
    const p = path.join(tmpExtractBase, "check.tar");
    await fs.promises.writeFile(p, tarBuf);
    expect(await isTarFile(p)).toBe(true);
  });

  it("returns false for a plain CSV file on disk", async () => {
    const p = path.join(tmpExtractBase, "check.csv");
    await fs.promises.writeFile(p, "lon,lat,depth\n-136.0,58.5,50\n");
    expect(await isTarFile(p)).toBe(false);
  });

  it("returns false for a file shorter than 262 bytes", async () => {
    const p = path.join(tmpExtractBase, "tiny.bin");
    await fs.promises.writeFile(p, Buffer.alloc(100));
    expect(await isTarFile(p)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractTarBuffer
// ---------------------------------------------------------------------------

describe("extractTarBuffer — in-memory extraction", () => {
  it("extracts entries from a tar buffer to a directory", async () => {
    const outDir = path.join(tmpExtractBase, "buf-extract-1");
    const entries = await extractTarBuffer(tarBuf, outDir);

    expect(entries).toContain("survey.xyz");

    const content = await fs.promises.readFile(path.join(outDir, "survey.xyz"), "utf8");
    expect(content.trim()).toBe("-136.0 58.5 50");
  });

  it("creates the target directory if it does not exist", async () => {
    const outDir = path.join(tmpExtractBase, "buf-extract-2", "nested");
    await extractTarBuffer(tarBuf, outDir);
    await expect(fs.promises.stat(outDir)).resolves.toBeTruthy();
  });

  it("returns all entry paths for a multi-entry archive", async () => {
    const multiTar = await makeTarBuffer([
      { name: "a.xyz", content: "1 2 3\n" },
      { name: "b.txt", content: "hello\n" },
    ]);
    const outDir = path.join(tmpExtractBase, "buf-extract-multi");
    const entries = await extractTarBuffer(multiTar, outDir);

    expect(entries).toContain("a.xyz");
    expect(entries).toContain("b.txt");
    expect(entries.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// extractTarFile
// ---------------------------------------------------------------------------

describe("extractTarFile — file-on-disk extraction", () => {
  it("extracts entries from a tar file to a directory", async () => {
    const tarPath = path.join(tmpExtractBase, "input.tar");
    await fs.promises.writeFile(tarPath, tarBuf);

    const outDir = path.join(tmpExtractBase, "file-extract-1");
    const entries = await extractTarFile(tarPath, outDir);

    expect(entries).toContain("survey.xyz");
    const content = await fs.promises.readFile(path.join(outDir, "survey.xyz"), "utf8");
    expect(content.trim()).toBe("-136.0 58.5 50");
  });
});

// ---------------------------------------------------------------------------
// Non-tar gz round-trip
// ---------------------------------------------------------------------------

describe("non-tar gz detection", () => {
  it("does NOT flag a plain csv.gz as a tar", () => {
    const csv = Buffer.from("lon,lat,depth\n-136.0,58.5,50\n");
    const gz = zlib.gzipSync(csv);
    const decompressed = zlib.gunzipSync(gz);
    expect(isTarBuffer(decompressed)).toBe(false);
  });

  it("correctly identifies a tar.gz decompressed payload as tar", () => {
    const decompressed = zlib.gunzipSync(tarGzBuf);
    expect(isTarBuffer(decompressed)).toBe(true);
  });
});
