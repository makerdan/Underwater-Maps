---
id: intertidal-hotspots
title: Intertidal Hotspots
section: Features
order: 12
---

# Intertidal Hotspots

The **Intertidal Hotspots** layer overlays scored polygons on the 3D scene that highlight shoreline areas most suitable for tidepooling or beachcombing. Each polygon comes from **NOAA ShoreZone / AOOS** coastal classification data and carries two independent scores — one for tidepool suitability (teal) and one for beachcombing suitability (amber).

## Enabling the layer

Open the **Overlays** panel in the left sidebar and click **🌊 INTERTIDAL HOTSPOTS**. The toggle state is remembered between sessions.

Once enabled, scored polygons appear draped just above the ocean surface. Use the **Tidepool / Beachcombing** mode toggle (in the same panel or on the Overview Map) to switch which score is visualised.

## Scoring modes

| Mode | Colour | What it measures |
| --- | --- | --- |
| **Tidepool** | Teal `#0d9488` | How suitable the shore zone is for observing intertidal pools, rocky platforms, and marine life |
| **Beachcombing** | Amber `#d97706` | How suitable the shore zone is for walking, collecting shells, or finding drift items |

Polygon opacity scales with the active score (0–100). Brighter, more opaque polygons are the highest-scoring spots. Polygons whose active score is below 10 are hidden to reduce clutter.

## How scores are calculated

Each ShoreZone unit is scored on four signals:

| Signal | Description |
| --- | --- |
| **Bioband** | Presence and density of biological banding — barnacles, mussels, kelp wrack — indicating tidal exposure and productivity |
| **Debris** | Amount of wrack, drift wood, and shell material deposited by tidal action (relevant to beachcombing potential) |
| **Energy** | Wave energy class of the shore (exposed vs. sheltered) — high energy favours diverse life; sheltered bays favour safe walking |
| **Human Use** | Existing human access and use patterns that improve or limit suitability |

The composite score (0–100) is computed server-side from these signals weighted differently for each mode. A summary sentence is included in the card explaining why the spot scored as it did.

## Reading the hotspot card

Click any polygon to open the **Intertidal Hotspot Card** at the bottom of the screen:

| Element | Description |
| --- | --- |
| **ShoreZone class** | The NOAA ShoreZone classification label for the unit (e.g. "Bedrock, Moderate Energy") |
| **Score dials** | Tidepool score (teal) and Beachcombing score (amber) shown as circular gauges; the active mode dial is visually emphasised |
| **Why summary** | One- or two-sentence explanation of the key factors driving the active score |
| **Signal chips** | Tags for Bioband, Debris, Energy, and Human Use signals that contributed to the score |
| **Substrate** | Substrate class used in scoring |

Close the card with the **✕** button or by clicking elsewhere on the scene.

## Data source

Polygon geometry and classifications are sourced from the **NOAA ShoreZone** coastal habitat program, distributed via the **Alaska Ocean Observing System (AOOS)** portal. Coverage is currently limited to datasets that include ShoreZone shoreline units.

## Tips

- Switch between **Tidepool** and **Beachcombing** mode to see which areas rank differently for each activity — a high-energy rocky shore may score high for tidepooling but low for beachcombing.
- Combine the Intertidal Hotspots layer with the [Tidal Overlay](#article:tidal-overlay) to see current tidal stage and plan your visit at low tide when pools are most exposed.
- Hotspot pins also appear on the [Overview Map](#article:overview-map) so you can scout locations before zooming in.
- See [HUD Overlay Toggles](#article:hud-overlays) for the full list of available overlays.
