---
name: API-guard body extraction ordering
description: Why concise-arrow extraction must run before braces-body extraction in the root-relative API guard
---
The fetch-wrapper scanner extracts a function body two ways: braces body (first balanced `{...}` after the match) and concise arrow body (expression after `=>` up to `;`, spanning newlines with a length cap).

**Rule:** always try concise-arrow extraction first.

**Why:** a concise body like `fetch(url, { credentials: "include" })` contains an object literal; the braces-body extractor mistakes it for a function body and extracts only the object's contents, which may not contain the fetch call — the wrapper silently escapes detection.

**How to apply:** when extending the guard with new body-extraction forms, keep the most specific/syntax-aware extractor first and ensure each returns null cleanly when its form doesn't apply. Also: concise bodies must be captured across newlines (Prettier wraps long bodies after `=>`), never cut at the first `\n`.
