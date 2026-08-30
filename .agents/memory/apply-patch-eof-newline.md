---
name: apply_patch EOF newline
description: Preserve exact candidate-file bytes when applying a whole-file patch.
---

Whole-file additions made with the patch tool can omit the final newline even
when the source file has one. For byte-exact replacements, compare the result
against the source and, if needed, apply a final blank patch line before
rechecking.

**Why:** A documentation candidate can otherwise differ only at EOF and fail
the required exact-content verification.

**How to apply:** After replacing a complete tracked text file, run a byte
comparison and an explicit line-count/EOF check before declaring the task done.