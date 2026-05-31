---
title: Accessibility Audit
---
# Accessibility Audit

## What & Why
BathyScan's 3D terrain canvas, keyboard shortcut system, and custom dialogs have specific accessibility failure modes: the R3F `<Canvas>` element may lack an `aria-label` and an `aria-live` region for depth announcements; single-key shortcuts may not be suppressed when focus is inside a text input; custom confirm/alert dialogs may lack correct ARIA roles or focus trapping; and `axe-core` scans may surface critical violations introduced by recent UI changes. This audit re-checks all of these.

## Done looks like
- The R3F `<Canvas>` element has a descriptive `aria-label` (e.g. "3D seafloor terrain viewer") and an `aria-live="polite"` region that announces depth and coordinate values as the cursor moves over the terrain.
- Every single-key shortcut registered in `lib/keyboardShortcuts.ts` (or equivalent) is suppressed when `document.activeElement` is an `<input>`, `<textarea>`, or `[contenteditable]` element.
- Every custom confirm/alert dialog in the app uses a Radix UI primitive (or equivalent) with `role="alertdialog"`, correct `aria-labelledby`/`aria-describedby`, and a focus trap that keeps keyboard focus inside the dialog until it is dismissed.
- `axe-core` run against the main viewport (with terrain loaded if feasible) returns zero critical violations; any non-critical violations are documented.
- All findings are either fixed inline or tracked as follow-up tasks.

## Out of scope
- Screen-reader compatibility on non-desktop platforms.
- Color contrast for the 3D terrain colour palette (tracked separately if needed).
- WCAG AAA compliance beyond what axe-core flags as critical.

## Steps
1. **Audit R3F `<Canvas>` ARIA attributes** — Find the `<Canvas>` component render; confirm it has `aria-label` and that a sibling `<div aria-live="polite">` (or equivalent) receives depth/coordinate updates as state changes. Add both if missing.

2. **Audit keyboard shortcut suppression** — Read `lib/keyboardShortcuts.ts` (or wherever shortcuts are registered); confirm each handler checks `event.target` or `document.activeElement` before firing. Add suppression logic if any shortcut fires unconditionally while a text input is focused.

3. **Audit custom dialogs** — List every custom confirm/alert/modal dialog component; for each, check that it either (a) uses a Radix `<AlertDialog>` or `<Dialog>` primitive, or (b) manually sets `role="alertdialog"`, `aria-modal="true"`, and traps focus with a `FocusTrap` component. Fix any dialog that relies solely on visual styling without ARIA semantics.

4. **Run `axe-core` against the main viewport** — Install `axe-core` as a dev dependency if not present; write a Playwright or Vitest-browser test that loads the main page, waits for the canvas, and calls `axe.run()`; assert zero critical violations. Document any non-critical findings.

5. **Fix all critical findings** — For each critical violation from step 4, fix it and re-run `axe-core` to confirm resolution.

6. **Document non-critical findings** — List non-critical violations with element selector, rule ID, and a rationale for deferral if not fixed now.

## Relevant files
- `artifacts/bathyscan/src/` — R3F `<Canvas>` render location (search for `<Canvas`)
- `artifacts/bathyscan/src/lib/keyboardShortcuts.ts` (or equivalent)
- `artifacts/bathyscan/src/components/` — custom dialog components
- `artifacts/bathyscan/src/__tests__/` — existing accessibility tests if any
