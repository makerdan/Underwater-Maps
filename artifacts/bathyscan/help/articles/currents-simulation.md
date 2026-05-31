---
id: currents-simulation
title: Currents Simulation
section: Features
order: 6.2
showQA: true
---

# Currents Simulation

The **Currents** panel overlays a live or manually configured current field on the 3D scene. It works alongside the [Tidal Overlay](#article:tidal-overlay) panel, which controls tidal height and timing; the Currents panel controls *how the water is rendered moving* rather than the tidal gauge readings.

## Enabling the panel

Click the **↬ CURRENT** button in the [Overlays panel](#article:hud-overlays) (left sidebar) to turn the current overlay on. The **◈ CURRENTS** card appears in the sidebar. To disable it, click the **OFF** button inside the card or toggle the HUD button again.

## Data source

Two source modes are available:

| Mode | Description |
| --- | --- |
| **NOAA** (default) | Pulls real-time current speed and direction from the nearest NOAA tidal station, filtered through the harmonic forecast. Changes automatically as you move the time scrubber in the Tidal Overlay panel. |
| **Manual** | You set an exact compass bearing (0–360°) and speed. Useful for modelling specific scenario conditions or for areas with no nearby NOAA current station. |

Switch between modes with the **NOAA** / **MANUAL** toggle buttons at the top of the card.

### Manual inputs

When Manual is active:

- **Direction** — compass bearing in degrees the current is flowing *toward* (e.g. 90 = flowing east).
- **Speed** — current speed in your chosen units (knots, mph, or km/h). Set it to 0 to model slack water.

### NOAA mode details

In NOAA mode a status line shows whether the tide is currently **Flooding**, **Ebbing**, or **Slack**, and what the source station is. If the station data cannot be fetched, the overlay falls back to harmonic estimates and shows a **`PREDICTED`** badge (the same badge shown in the Tidal panel).

## Tide-phase scrubber

The **Tide Phase** slider (0–100) lets you manually step through one full tidal cycle — from flood peak, through slack, to ebb peak, and back to flood — independent of real clock time. Useful for visualising how currents will look at a chosen tidal stage.

The **Auto** toggle (next to the slider) causes the phase to advance automatically in real time so the on-screen arrows continuously animate through the cycle.

## Visualisation layers

Three overlay styles can be mixed or used alone:

| Layer | What you see |
| --- | --- |
| **Particles** | Dots that drift with the current, giving an intuitive sense of flow. Density tracks with current speed. |
| **Arrows** | Discrete directional arrows arranged in a grid, sized by speed. Good for spotting exact direction at a glance. |
| **Streamlines** | Continuous flow lines that trace through the field. Ideal for seeing large-scale eddies and convergence zones. |

Click each button to toggle it on or off. All three can be active simultaneously.

## Speed colour ramp

The **Speed** legend strip at the bottom of the card shows the colour scale from slow (cool blue) to fast (warm cyan-white). Arrows and particle colours map to this same ramp so you can estimate relative speed anywhere in the scene.

## Relationship to tidal arrows

The Tidal Overlay panel has its own **↬ CURRENT** arrow layer with per-depth controls (Surface / Mid-col / Near-btm). The Currents simulation panel is a **separate, additive** layer — you can run both at the same time. The Tidal arrows represent NOAA's layered data; the Currents simulation provides a single, uniform-field visualisation that is faster to tune manually.

## Troubleshooting

- **Arrows or particles not visible** — make sure the **↬ CURRENT** toggle in the Overlays panel is on and that at least one of Particles / Arrows / Streamlines is enabled.
- **"NOAA fetch failed" message** — no reachable current station nearby. Switch to Manual and enter approximate values from a local tide table.
- **Speed shows 0 in NOAA mode** — you may be at a slack window. Check the Tidal Overlay panel for the slack indicator on the hour slider.
