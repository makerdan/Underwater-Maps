---
id: explore-mode
title: Explore Mode Walkthrough
section: Workflows
order: 1
---

# Explore Mode Walkthrough

The **Explore tab** is the starting point for every BathyScan session. It gives you everything you need to pick a dataset, configure what you can see on the 3D scene, and search for new data to add to your library.

## Step 1 — Switch to the Explore tab

Click the **Explore** label at the top of the left sidebar. The sidebar fills with the Datasets panel and the Overlays panel. If the sidebar is hidden, click **▸ SHOW** first.

## Step 2 — Choose your environment

At the top of the Datasets panel is the **Environment toggle**:

- **Saltwater** — shows ocean, coastal, and estuary datasets, plus saltwater-only overlays (NOAA weather stations, EFH, Intertidal Hotspots).
- **Freshwater** — shows lake and river datasets and switches the default colormap to the Freshwater palette.

Switching the environment filters the built-in dataset list. Your own uploaded datasets are always shown regardless of environment.

## Step 3 — Pick a dataset

Scroll the **Datasets panel** to find the region you want. Built-in datasets are grouped by geography. Click one to load it — the 3D terrain switches immediately.

### Finding a dataset you've saved

Your uploads and any catalogue datasets you have saved appear under **Your saved datasets**. Click one to load it.

### Searching the catalogue

Click **🔍 FIND DATA** in the Overlays panel to open the Find Data drawer. Type a place name or habitat description (e.g. "Thorne Bay", "kelp beds Oregon") and press Enter. Results show source, resolution, and a preview. Click **Save** on any result to add it to your saved list.

## Step 4 — Control overlay layers

The **Overlays panel** contains toggle buttons for every environmental layer. All overlays are available any time their toggle is on — they do not require a separate data-loading step.

| Toggle | When to use |
| --- | --- |
| ◼ SUBSTRATE | Visualising habitat type — recolours terrain by substrate class |
| 💨 WIND | Checking surface wind direction and relative speed |
| 🌊 TIDE | Seeing tidal-flow arrows on the scene |
| ↬ CURRENT | Seeing sub-surface current arrows at your chosen depth layer |
| 🌿 / 🛩 WEATHER STATIONS | Checking local observations — click a pin for a full weather popover |
| 🌊 INTERTIDAL HOTSPOTS | Finding tidepool and beachcombing areas |
| 🐟 EFH | Viewing Essential Fish Habitat polygons (saltwater, data-dependent) |

Toggle multiple layers at once — they are all independent of each other.

## Step 5 — Browse the 3D scene

Use the standard camera controls to explore the terrain:

- **Orbit mode** — drag to rotate, scroll to zoom.
- **Fly mode** — click the scene to enter, WASD to move, Esc to exit.

Press **O** (or click **🗺 OVERVIEW**) to open the Overview Map for a top-down reference view.

## Step 6 — Hide the sidebar for a clean view

Click **◂ HIDE** at the top of the sidebar to collapse the entire left column. All HUD overlays remain active. Click **▸ SHOW** to bring the sidebar back. The section states (collapsed or expanded) you left behind are remembered when you return.

## Tips

- Use the **Find Data** drawer's **My Saves** tab to see all datasets you have ever saved, with their status (available, processing, error).
- Switching the Environment toggle does not unload your current dataset — it only changes the list and the default colormap.
- If a Wind, Tide, or Current arrow layer shows no arrows, check that the relevant toggle in the Overlays panel is on *and* that tidal data has been loaded (see the [Tidal Overlay](#article:tidal-overlay) article).
