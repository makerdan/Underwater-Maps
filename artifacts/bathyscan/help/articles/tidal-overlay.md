---
id: tidal-overlay
title: Tidal Overlay
section: Features
order: 6
---

# Tidal Overlay

The **Tidal Overlay** panel surfaces real-time and predicted tidal conditions for the area you are exploring, along with controls for visualising sub-surface currents, scrubbing time, and adjusting arrow density per layer.

## What it shows

- **Station** — the closest NOAA / harmonic station that the readings come from. If no station is within 100 km of your view, the panel says so instead of guessing.
- **Tide height** — current water level relative to MLLW (Mean Lower Low Water). A `PREDICTED` badge appears when the value is from the harmonic forecast rather than a live gauge observation.
- **Direction & speed** — direction the tidal current is flowing and its speed in knots. The status line shows whether the tide is **Flooding** (rising toward high), **Ebbing** (falling toward low), or in a brief **Slack** window while the current reverses.
- **Next event** — countdown to the next high or low tide.
- **SIMULATED badge** — appears on the arrow overlay when the tidal arrow data is modelled from harmonics rather than sourced from a real-time current station. The badge is displayed at the top of the arrow layer on the scene; it is informational and does not affect accuracy of the height readings.

## Slack windows

Slack tide is the short period around a high or low when the current is near zero and reverses direction. The panel highlights slack windows two ways:

- A purple **band** along the hour slider shows the time range of each slack window on the selected day.
- A **tick mark** at the centre of each band marks the exact predicted slack time. Hover the tick to see the time and event type.

The day buttons show a small `◐N` badge with the number of slack windows that fall on that day, so you can pick a day with favourable slack timing at a glance.

## Current layer

The three buttons under **Current layer** switch the on-scene arrows between:

- **Surface** — wind-driven and surface tidal flow.
- **Mid-col** — depth-averaged mid-water flow.
- **Near-btm** — the layer right above the seafloor, which often differs from the surface during strong tides.

## Per-layer arrow density

Each current layer has its own **Arrow Density** slider. Drag it left for fewer, larger arrows (easier to read from far away) or right for a denser grid (better spatial resolution up close). The density setting is remembered per layer and per session.

You can also click the **Reset** icon next to the slider to return that layer to its default density.

## Time scrub

Use the day buttons and hour slider to jump the entire scene (arrows, height readout, status line) to a different moment. The label under the slider shows the active time and reads **(Live)** when you are tracking the current moment. Selecting **Today** at the current hour returns to live mode.

## Auto-load setting

**Settings → Data Loading → Auto-Load Tidal Data** controls whether the tidal overlay switches on automatically when you load a new dataset. Turn this off if you prefer to enable it manually. When the setting is off, the 🌊 TIDE and ↬ CURRENT HUD buttons still work; only the automatic activation is disabled.

## Troubleshooting

- **"No tidal station within 100 km"** — you have moved to an area with no nearby harmonic data. Pan back toward the coast to re-enable the panel.
- **`PREDICTED` badge stays on** — the live gauge feed is unavailable. Numbers are still accurate to within harmonic prediction error (~5–10 cm for height, ~0.1 kn for speed).
- **`SIMULATED` badge on arrows** — the arrow data for this area is modelled, not from a real-time current station. Direction and relative speed are reliable; absolute magnitudes are estimates.
- **Arrows not visible** — check that the **🌊 TIDE** or **↬ CURRENT** HUD toggle is on. The tidal panel controls time and layer, but the HUD button controls visibility.

## Related features

- [Currents Simulation](#article:currents-simulation) — the separate currents panel that renders particles, arrows, and streamlines driven by NOAA data or manual speed/direction inputs.
