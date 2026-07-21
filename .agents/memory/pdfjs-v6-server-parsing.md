---
name: pdfjs v6 server-side parsing quirks
description: Gotchas when using pdfjs-dist v6 legacy build in Node for vector/text extraction (contour PDF ingestion)
---

- **destroy() lives on the loading task, not the document proxy.** `pdfjs.getDocument(...)` returns a loading task; `doc = await task.promise`. Call `task.destroy()` in `finally` — `doc.destroy` does not exist in v6 and throws `TypeError: doc.destroy is not a function`, masking the real result inside a try/finally.
- **`isEvalSupported` is a real runtime option but missing from `DocumentInitParameters` typings** — cast the init object (`as Parameters<typeof pdfjs.getDocument>[0]`) rather than dropping the hardening flag.
- constructPath args in v6: `[drawOpCode, [subpathFlatArrays], minMax]`; subpath flat arrays are `[cmd, coords...]` with 0=moveTo, 1=lineTo (2 coords), 2=curveTo (6 coords), 3=closePath.
- Use `disableFontFace: true, useSystemFonts: true` to suppress standard-font warnings when only reading positioned text (no rendering).
- In-memory hand-built uncompressed PDFs (latin1 buffer, correct xref offsets) work as deterministic test fixtures — avoids on-disk fixture binaries and the fixture-freshness check.
