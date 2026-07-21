---
name: Font scale convention
description: How the Text Size accessibility setting scales all UI text via --bs-font-scale
---
The Text Size setting (`globalFontSize`) is applied solely via the `--bs-font-scale` CSS variable set on `<body>` by AccessibilityClassesEffect. No inline `body.style.fontSize` is ever set.

**Rule:** any inline `fontSize` in bathyscan components must be written as `fontSize: "calc(Npx * var(--bs-font-scale, 1))"`, and any px font-size in index.css (daylight mode, media queries) must multiply by the var. Never hardcode a bare px font size.

**Why:** an inline body px override clobbers daylight-mode CSS, and bare px inline sizes ignore the setting entirely — this was the original bug (setting only scaled a fraction of the UI).

**How to apply:** new components copy the calc pattern; 3D drei `<Text fontSize={N}>` and SVG chart `fontSize={N}` attrs are intentionally exempt (canvas/scene labels). A unit test in brightDaylight.test.tsx asserts the pattern on settings shared styles.
