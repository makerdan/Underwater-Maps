---
name: Skill ZIP retention across rebases
description: Preserving byte-for-byte provenance of private skill ZIP archives after branch syncs.
---

**Rule:** After rebasing or merging changes that touch skill ZIPs, verify every private archive against its manifest hash. If a content-addressed archive path contains different bytes, restore the exact recorded bytes from trusted pre-sync history; do not update the manifest to bless substituted content.

**Why:** A branch sync replaced a retained legacy skill ZIP with a newer similarly named package while leaving its path and manifest hash unchanged. The retention check caught the provenance mismatch.

**How to apply:** Run the retention check after branch syncs. Trace any mismatch to repository history or a known source before restoring it, and stop if the original bytes cannot be verified.