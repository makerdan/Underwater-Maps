---
id: throttle
title: Throttle Panel
section: Features
order: 8.5
showQA: true
---

# Throttle Panel

The **Throttle** panel is a virtual boat-speed lever used by realistic mode and
the drift/trolling planner. The speed you set here drives:

- The HUD `SPD` readout (in MPH/KPH and knots).
- The simulated boat heading and movement when **Realistic mode** is on.
- The trolling leg distances and arrival times in the **Drift Planner**.

## Controls

- **Lever** — click and drag the cyan thumb up or down the track. The fill
  bar behind the thumb mirrors the current power level.
- **Tick marks** — the numbers on the right are preset speeds. Click any tick
  to snap to it. The active tick lights up cyan.
- **Number input** — type an exact MPH value at the bottom and press
  <kbd>Enter</kbd>. Out-of-range values are clamped between the boat's minimum
  and maximum cruising speed.
- **Track** — click anywhere along the track to jump the thumb to that
  position.

## Display

The big readout shows the current speed in your preferred display units
(MPH or KPH), with the equivalent in nautical knots underneath. Knots is the
standard unit used by NOAA tidal-current data and most charts, so it's always
shown for cross-reference.

## Collapse / close

- **▼** collapses the panel into a slim status pill that still shows the
  current speed. Click the pill to expand again.
- **✕** (when shown) closes the panel completely; reopen it from the realistic-
  mode toggle in the HUD.

## Tips

- The lever range maps to your boat's plausible cruising window — values
  outside it can't be entered. Set custom limits in **Settings → Data &
  Storage** if your real-world vessel differs.
- Speed is preserved across sessions, so the next time you open the app the
  throttle resumes where you left it.
