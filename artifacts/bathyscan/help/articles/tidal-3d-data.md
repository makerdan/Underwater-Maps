---
id: tidal-3d-data
title: Tidal 3D Data
section: Features
order: 6.5
---

# Tidal 3D Data

The **TIDAL 3D** toggle activates a full suite of animated tidal visualisation features: a live 3D water plane, NOAA station data, the Tidal panel, and current-layer arrows — all updated together as you scrub through time.

## What TIDAL 3D activates

Turning on TIDAL 3D (the button appears in the Plan tab sidebar and in the HUD) activates:

1. **Animated 3D water plane** — a rendered water surface at the current tide height, rising and falling as you scrub the time slider.
2. **NOAA station data fetch** — the app queries the nearest NOAA harmonic station (within 100 km) for tide height and tidal current predictions.
3. **Tidal panel** — the full tide-height readout, direction/speed display, slack-window bands, next-event countdown, day picker, and hour slider become active in the Plan tab.
4. **Current-layer arrow overlays** — the 🌊 TIDE and ↬ CURRENT HUD toggle buttons now control animated arrow layers driven by the fetched station data.

## How it differs from the 🌊 TIDE overlay toggle

There are two separate controls:

| Control | What it does |
| --- | --- |
| **TIDAL 3D button** (Plan tab / HUD) | Loads NOAA data, activates the Tidal panel, raises the animated water plane |
| **🌊 TIDE toggle** (Overlays panel, Explore tab) | Shows or hides the tidal-flow arrows on the scene — works independently once TIDAL 3D is on |

You can turn 🌊 TIDE arrows off without turning off TIDAL 3D (to hide clutter while keeping the water plane and height readout). You can also turn 🌊 TIDE on before TIDAL 3D is active, but no arrows will appear until station data is loaded.

## Current-layer buttons

Three buttons in the Tidal panel switch which depth of the water column the arrows represent:

| Layer | What it shows |
| --- | --- |
| **Surface** | Wind-driven and surface tidal flow |
| **Mid-col** | Depth-averaged mid-water column flow |
| **Near-btm** | The layer immediately above the seafloor — often differs from surface during strong tides |

Each layer has its own **Arrow Density** slider. Adjust density independently per layer and per session.

## Time scrub

Use the **day picker** and **hour slider** in the Tidal panel to move to any point in time:

- The animated water plane rises or falls to the height at that moment.
- The arrow overlay updates to the current direction and speed for the selected layer at that time.
- The height readout, direction/speed label, and Flooding/Ebbing/Slack status all update.
- The label below the slider shows the active time and reads **(Live)** when tracking the current moment.

Selecting **Today** at the current hour returns to live mode.

## Slack-window visualisation

Slack tide — the brief period when current near-reverses — is shown two ways:

- A **purple band** along the hour slider marks the full time range of each slack window.
- A **tick mark** at the band's centre marks the exact predicted slack moment. Hover it to see the time and event type.

The day picker shows a **◐N** badge with the number of slack windows that fall on each day, making it quick to choose a day with favourable tidal timing.

## SIMULATED and PREDICTED badges

| Badge | Meaning |
| --- | --- |
| **PREDICTED** | Tide-height value is from the harmonic forecast, not a live gauge reading. Accuracy is typically within 5–10 cm. |
| **SIMULATED** | Arrow overlay data is modelled from harmonics, not sourced from a real-time current station. Direction and relative speed are reliable; absolute magnitudes are estimates. |

These badges are informational — the data is still useful for planning. When a live gauge comes back online, the PREDICTED badge disappears and the height readout is replaced by the observed value.

## Auto-load setting

**Settings → Tidal → Auto-Load Tidal Data** controls whether TIDAL 3D switches on automatically whenever you load a new dataset. Turn this off if you prefer to activate it manually per session.

## Troubleshooting

- **"No tidal station within 100 km"** — you are viewing an area with no nearby harmonic data. Pan toward the coast and the panel will re-enable.
- **Arrows not visible** — check that the **🌊 TIDE** or **↬ CURRENT** toggle in the Overlays panel is on, and that TIDAL 3D is active. The Tidal panel controls time and layer, but the Overlays toggles control arrow visibility.
- **Water plane at wrong height** — verify you are in live mode (slider shows "(Live)"). If the time scrub has been moved, return to Today/current hour to resync.

## Related features

- [Tidal Overlay](#article:tidal-overlay) — full reference for the Tidal panel controls.
- [Plan Mode Walkthrough](#article:plan-mode) — step-by-step guide to using the Plan tab including the Drift Planner and Throttle panel.
