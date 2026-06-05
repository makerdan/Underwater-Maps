/**
 * bag-parse-failure.test.ts
 *
 * Verifies that parseBag surfaces a human-readable error when the input is
 * not a valid HDF5 / BAG file.  The underlying parser is now bag_parser.py
 * (h5py + pyproj) rather than h5wasm, so we test the Python-subprocess error
 * path directly rather than mocking a WASM module.
 */

import { describe, it, expect } from "vitest";
import { parseBag } from "../lib/uploadParsers.js";

describe("BAG parser — invalid-file error path", () => {
  it(
    "throws a descriptive error when the buffer is not a valid HDF5/BAG file",
    async () => {
      const junk = Buffer.from("this is definitely not an HDF5 / BAG file at all");
      const err = await parseBag(junk).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(Error);
      const msg = (err as Error).message;

      // Must contain something about BAG or the parse failure so the user
      // gets actionable feedback instead of a generic "non-zero exit" message.
      expect(msg.toLowerCase()).toMatch(/bag/i);
    },
    30_000,
  );
});
