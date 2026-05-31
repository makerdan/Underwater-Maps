---
id: overview-map
title: Overview Map
section: Features
order: 12
showQA: true
---

# Overview Map

The **Overview Map** is a top-down minimap that shows the entire active dataset, your camera's current position, your markers, and (when overlays are active) tidal arrows — all at a glance without leaving the 3D view.

## Opening and closing

- Press **O** to toggle the map open or closed.
- Click the **🗺 OVERVIEW** button in the Overlays panel (left sidebar).
- The map opens as a floating panel. You can drag it to any corner of the screen.

## What the map shows

| Element | Appearance |
| --- | --- |
| Dataset footprint | The full extent of the loaded bathymetric data |
| Camera position | A small **▲** arrow showing where you are and which way you are facing |
| Markers | Coloured dots using each marker type's colour. Hover a dot for the marker label |
| Tidal arrows | When the 🌊 TIDE or ↬ CURRENT overlay is on, arrows appear at the same scale as the 3D scene |
| Drift/trolling track | When the Drift Planner is active, the predicted track line appears here |
| GPS trail | When the GPS trail recorder is running, the breadcrumb trail is drawn here |
| Weather station pins | When NOAA or RAWS weather station overlays are on, pins appear here too |

## Geographic bounding box tooltip

Hover anywhere on the overview map to see a **lat/lon tooltip** showing the geographic coordinates at that point. This helps you quickly read off the bounding box corners or find the coordinates of a feature you spot on the minimap.

## Satellite imagery toggle

Inside the overview map panel there is a **Satellite** toggle. When on, the minimap background switches from the flat depth-colormap render to a satellite image tile, giving geographic context (coastlines, land features, water colour). This setting is independent of the 3D scene's satellite imagery setting.

## Marker dots

Each marker type is represented as a colour-coded dot:

- Hover a dot to see the marker's label, type, and depth.
- Click a dot to teleport the 3D camera to that marker's location.

## Syncing with the 3D camera

The **▲** arrow on the minimap always tracks the 3D camera in real time — in both Orbit and Fly modes. When you fly around, the arrow moves. When you click a marker dot on the minimap the 3D scene cuts to that location.

## Tips

- Use the minimap to orient yourself after long free-flight sessions — the **▲** arrow shows exactly where you are relative to the dataset edge.
- The bounding-box tooltip is useful for writing down the lat/lon of a spot you want to revisit on a paper chart or plotter.
- Combine the satellite toggle with tidal arrows for the most informative minimap view on a fishing day.
