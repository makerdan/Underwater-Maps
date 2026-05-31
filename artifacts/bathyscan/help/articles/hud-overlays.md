---
id: hud-overlays
title: HUD Overlay Toggles
section: Features
order: 11
---

# HUD Overlay Toggles

The **Overlays** panel sits in the **left sidebar**, below the main dataset controls. It collects all the environmental overlay toggles in one place so you can switch layers without hunting through settings.

## How to open the Overlays panel

The panel is always visible in the left column. If the left sidebar is hidden, click **▸ SHOW** to reveal it.

## Toggles

| Button | What it does |
| --- | --- |
| 🗺 OVERVIEW | Opens/closes the top-down Overview Map (same as pressing **O**) |
| 🔍 FIND DATA | Opens the dataset search and browse drawer — see [Find Data](#article:find-data) |
| ◼ SUBSTRATE | Tints the seafloor by classified substrate type (sand, silt, sediment, basalt) |
| 💨 WIND | Overlays surface wind-direction arrows; colour intensity scales with speed |
| 🌊 TIDE | Overlays tidal-flow arrows (pair with the [Tidal Overlay](#article:tidal-overlay) panel) |
| ↬ CURRENT | Overlays sub-surface current arrows at the selected depth layer |
| 🛩 NOAA WEATHER STATIONS | Toggles NOAA ASOS/AWOS aviation weather station pins (saltwater only) |
| 🌿 RAWS WEATHER STATIONS | Toggles AOOS RAWS land weather station pins (saltwater only) |
| 📷 FAA WEATHERCAMS ↗ | Opens the FAA WeatherCams page for your region in a new browser tab (saltwater only) |
| 🌊 INTERTIDAL HOTSPOTS | Toggles scoring and pin display for tidepool and beachcombing hotspot areas |
| 🐟 EFH | Overlays Essential Fish Habitat polygons (only on datasets that include EFH data) |

## Weather station pins (NOAA and RAWS)

When **🛩 NOAA WEATHER STATIONS** or **🌿 RAWS WEATHER STATIONS** is on, coloured pins appear on the 3D scene and the [Overview Map](#article:overview-map):

- **NOAA ASOS/AWOS stations** appear as **yellow pins** labelled **W**.
- **RAWS land stations** appear as **green pins** labelled **R**.

Click any pin to open a detail popover showing:

| Field | Description |
| --- | --- |
| Station ID | ICAO identifier (e.g. KBLI) |
| Wind | Speed in knots and direction (e.g. NE 45° @ 12 kt) |
| Visibility | In statute miles (imperial) or km (metric) |
| Ceiling | In feet AGL, or CLEAR when no significant cloud |
| Temp | In °C or °F |
| Obs time | Time of the observation in UTC |
| FAA WeatherCams ↗ | Link to the FAA WeatherCams page for the region |

A **STALE** badge appears on the popover if the observation is being served from cache rather than a fresh fetch.

## FAA WeatherCams

The **📷 FAA WEATHERCAMS ↗** button is an **external link** — clicking it opens the FAA WeatherCams website for the relevant region in a new browser tab. It is not a pin layer on the scene.

## Tips

- Weather station buttons are only shown when the **Saltwater** environment is active.
- Toggles are independent — you can leave SUBSTRATE on while flipping TIDE and CURRENT.
- The state of every toggle is remembered between sessions.
- **🌊 TIDE** and **↬ CURRENT** work together with the [Tidal Overlay](#article:tidal-overlay) panel's time scrub and per-layer density controls.
