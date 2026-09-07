---
name: Skill projection boundaries
description: Source/projection refreshes must reject canonical path overlap and detect source identity changes even when bytes revert.
---

Reject source and projection tree overlap using canonical identities before
creating helper state. A coherent staged projection must be written from
captured source bytes, then revalidated against both content hashes and stable
filesystem identity; content-only checks cannot detect a change-and-revert
race.

**Why:** A source can alias or contain its generated projection, and a source
that changes and returns to its original bytes can otherwise produce a mixed
or falsely accepted refresh.

**How to apply:** Any future projection refresh or staging change must preserve
the pre-mutation overlap check and identity-aware snapshot validation.