---
name: NOAA gzip magic-byte detection
description: NOAA survey archives often have descriptive filenames with no .gz extension; the upload pipeline must use magic-byte detection to handle them.
---

## Rule
In `processUploadJob` (datasets.ts) and the GCS processing path (bucketMonitor.ts), always check gzip magic bytes (`0x1F 0x8B`) as a fallback before deciding whether to decompress — do not rely on `fileName.endsWith(".gz")` alone.

**Why:** NOAA's download portal names survey archives descriptively, e.g.:
`h09092.alaska - tolstoi bay & surrounding area - bathymetric data - h09092`
No `.gz` or `.tar.gz` extension is present even though the file content is a gzip-compressed tar archive. Without the magic-byte fallback, these files skip decompression, hit `sniffFormat()` as raw gzip bytes, and fail because `sniffFormat` has no gzip case.

**How to apply:**
- `isGzipFile(filePath)` helper lives in `tarDetect.ts` — reads 2 bytes, checks `0x1F 0x8B`.
- Both upload paths set `const looksLikeGzip = fileName.toLowerCase().endsWith(".gz") || await isGzipFile(path)` immediately after the file is assembled/downloaded.
- `baseFileName` still strips `.gz` only when the filename actually ends in it (not by magic bytes) — dataset naming stays correct for descriptive names.
- The inner tar-detection (`isTarFile`) runs after decompression and correctly routes to `routeTarEntries` for NOAA archives.
