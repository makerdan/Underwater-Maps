/**
 * tarDetect.ts — POSIX tar detection and extraction for NOAA smooth-sheet uploads.
 *
 * NOAA smooth sheet downloads arrive as .tar.gz archives — a tar archive
 * compressed with gzip — rather than a single file wrapped in gzip.  After
 * gunzip decompression the inner content is a raw tar stream, not a parseable
 * bathymetric file.  This module provides:
 *
 *   isTarBuffer(buffer)           — magic-byte check on an in-memory Buffer
 *   isTarFile(filePath)           — magic-byte check on a file on disk
 *   extractTarBuffer(buf, dir)    — extract tar from a Buffer to a directory
 *   extractTarFile(file, dir)     — extract tar from a file to a directory
 *
 * POSIX tar magic: the string "ustar" appears at byte offset 257 of the first
 * 512-byte header block.  GNU tar writes "ustar  \0" (two spaces + NUL) while
 * POSIX / PAX write "ustar\0" (one NUL), so we compare only the first 5 bytes
 * of the field to cover both variants.
 */

import * as fs from "fs";
import { Readable } from "stream";
import * as tar from "tar";
import type { ReadEntry } from "tar";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type DecompressResult =
  | { kind: "single"; buffer: Buffer }
  | { kind: "tar"; extractedDir: string; entries: string[] };

// ---------------------------------------------------------------------------
// Magic-byte detection
// ---------------------------------------------------------------------------

/** Byte offset of the "ustar" magic within a POSIX tar 512-byte header block. */
const TAR_MAGIC_OFFSET = 257;
/** First 5 bytes of the magic field — covers both POSIX ("ustar\0") and GNU ("ustar  \0"). */
const TAR_MAGIC = Buffer.from("ustar");

/**
 * Return true when `buffer` begins with a POSIX tar header.
 * A valid tar block is at least 512 bytes and carries "ustar" at offset 257.
 */
export function isTarBuffer(buffer: Buffer): boolean {
  if (buffer.length < TAR_MAGIC_OFFSET + TAR_MAGIC.length) return false;
  return buffer
    .slice(TAR_MAGIC_OFFSET, TAR_MAGIC_OFFSET + TAR_MAGIC.length)
    .equals(TAR_MAGIC);
}

/**
 * Return true when the file at `filePath` contains a POSIX tar archive.
 * Reads only the first 512 bytes (one tar block) to avoid loading the file.
 */
export async function isTarFile(filePath: string): Promise<boolean> {
  const fd = await fs.promises.open(filePath, "r");
  try {
    const buf = Buffer.alloc(512);
    const { bytesRead } = await fd.read(buf, 0, 512, 0);
    if (bytesRead < TAR_MAGIC_OFFSET + TAR_MAGIC.length) return false;
    return isTarBuffer(buf);
  } finally {
    await fd.close();
  }
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract all entries from a tar archive held in `buffer` to `extractedDir`.
 * The directory is created (recursively) if it does not exist.
 * Returns an array of the relative entry paths found in the archive.
 */
export async function extractTarBuffer(
  buffer: Buffer,
  extractedDir: string,
): Promise<string[]> {
  await fs.promises.mkdir(extractedDir, { recursive: true });
  const entries: string[] = [];

  await new Promise<void>((resolve, reject) => {
    const extract = tar.x({
      cwd: extractedDir,
      onentry: (entry: ReadEntry) => {
        entries.push(entry.path);
      },
    });

    extract.on("close", resolve);
    extract.on("error", reject);

    Readable.from(buffer).pipe(extract);
  });

  return entries;
}

/**
 * Extract all entries from a tar archive at `srcPath` to `extractedDir`.
 * The directory is created (recursively) if it does not exist.
 * Returns an array of the relative entry paths found in the archive.
 */
export async function extractTarFile(
  srcPath: string,
  extractedDir: string,
): Promise<string[]> {
  await fs.promises.mkdir(extractedDir, { recursive: true });
  const entries: string[] = [];

  await tar.x({
    file: srcPath,
    cwd: extractedDir,
    onentry: (entry: ReadEntry) => {
      entries.push(entry.path);
    },
  });

  return entries;
}
