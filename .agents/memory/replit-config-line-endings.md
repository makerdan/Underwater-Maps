---
name: Validated .replit replacement line endings
description: Temporary .replit replacement files sourced through shell output may acquire CRLF endings.
---

When replacing `.replit` through the validated temp-file flow, normalize the candidate to LF line endings before replacing it, then compare it byte-for-byte with the intended repository version.

**Why:** A successful validated replacement can still leave every line marked as trailing whitespace in Git when the candidate was serialized with CRLF endings.

**How to apply:** Prefer reading text through a file API and explicitly converting `\r\n` to `\n`; verify `git diff --check` and byte equality with the target config afterward.