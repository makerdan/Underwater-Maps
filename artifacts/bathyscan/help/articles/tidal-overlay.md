---
id: tidal-overlay
title: Tidal Overlay
section: Features
order: 6
---

# Tidal Overlay

The **Tidal Overlay** panel surfaces real-time and predicted tidal conditions
for the area you're exploring, along with controls for visualising sub-surface
currents and scrubbing forward or backward in time.

## What it shows

- **Station** — the closest NOAA / harmonic station that the readings come from.
  If no station is within 100 km of your view, the panel says so instead of
  guessing.
- **Tide height** — current water level relative to MLLW (Mean Lower Low Water).
  A `PREDICTED` badge appears when the value is from the harmonic forecast
  rather than a live gauge observation.
- **Direction & speed** — direction the tidal current is flowing and its speed
  in knots. The status line shows whether the tide is **Flooding** (rising
  toward high), **Ebbing** (falling toward low), or in a brief **Slack** window
  while the current reverses.
- **Next event** — countdown to the next high or low tide.

## Slack windows

Slack tide is the short period around a high or low when the current is near
zero and reverses direction. The panel highlights slack windows two ways:

- A purple **band** along the hour slider shows the time range of each slack
  window on the selected day.
- A **tick mark** at the centre of each band marks the exact predicted slack
  time. Hover the tick to see the time and event type.

The day buttons show a small `◐N` badge with the number of slack windows that
fall on that day, so you can pick a day with favourable slack timing at a
glance.

## Current layer

The three buttons under **Current layer** switch the on-scene arrows between:

- **Surface** — wind-driven and surface tidal flow.
- **Mid-col** — depth-averaged mid-water flow.
- **Near-btm** — the layer right above the seafloor, which often differs from
  the surface during strong tides.

## Time scrub

Use the day buttons and hour slider to jump the entire scene (arrows, height
readout, status line) to a different moment. The label under the slider shows
the active time and reads **(Live)** when you're tracking the current moment.
Selecting **Today** at the current hour returns to live mode.

## Troubleshooting

- **"No tidal station within 100 km"** — you've moved to an area with no nearby
  harmonic data. Pan back toward the coast to re-enable the panel.
- **`PREDICTED` badge stays on** — the live gauge feed is unavailable. Numbers
  are still accurate to within harmonic prediction error.
