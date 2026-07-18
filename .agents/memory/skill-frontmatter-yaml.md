---
name: Skill frontmatter YAML must parse
description: Invalid YAML in a SKILL.md description silently blocks skill-search indexing
---

Rule: a SKILL.md frontmatter description containing a colon-space (`: `) inside an unquoted single-line value is invalid YAML; the skill then never appears in skillSearch results, with no error anywhere.

**Why:** the bug-audit skill was invisible to skillSearch for several minutes of retries; the real cause was a YAML parse failure ("bad indentation of a mapping entry"), not index lag. Index refresh after a valid write takes ~1 minute.

**How to apply:** when authoring or editing any skill frontmatter, use a `>-` block scalar for long descriptions (or quote them), and validate with a YAML parser if the skill fails to surface in search. Wait ~60s after writing before testing discoverability.
