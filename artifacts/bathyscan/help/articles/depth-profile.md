---
id: depth-profile
title: Depth Profile
section: Features
order: 7
---

# Depth Profile

A **depth profile** is a vertical cross-section between two points — the same kind of chart you would see on a paper navigation chart. BathyScan supports both straight-line (A-to-B) profiles and multi-waypoint path profiles.

## Drawing a straight-line profile

1. In fly mode, right-click the first point (point **A**) and choose **Start straight-line profile** from the context menu (or press **Q** and choose the same option).
2. Move the crosshair to the second point (point **B**), right-click, and choose **End depth profile here**.

A panel slides in along the bottom centre showing:

- A line chart of depth vs distance.
- Length, minimum depth, maximum depth, and depth delta (Δ).
- A thin coloured **substrate strip** under the chart that shows the classified substrate at each sample point (Sand, Sediment, Silt, or Basalt).
- Latitude, longitude for both endpoints A and B.

![Depth profile panel](/help/depth-profile.png)

## Drawing a path profile

For multi-waypoint routes (e.g. a planned transect with several turns):

1. Right-click → **Start path profile** to set the first waypoint.
2. Right-click → **Add waypoint here** for each intermediate point.
3. Right-click → **Finish path here** when done.

The chart shows the entire path as a continuous depth line. A **Save as Route** button appears (for non-synthetic terrain) so you can name and save the path as a persistent route.

## Reading the chart

- The Y-axis is depth (positive down — deeper is lower on the chart).
- The X-axis is distance from A to B in metres.
- The cyan polyline is the actual seafloor.
- The faint gradient underneath is the area under the curve.
- The substrate strip uses four colours: Sand, Sediment, Silt, Basalt.

## Auto-detected features

The chart automatically marks significant terrain features:

| Symbol | Feature |
| --- | --- |
| ▲ | Hump or peak |
| ▼ | Hole or trough |
| ◆ | Ledge or step |

Click any symbol to drop a marker at that feature's coordinates.

## Hover tooltip

Move your mouse along the chart to see a live tooltip showing:

- **D** — cumulative distance from A at that point
- **Z** — depth at that point
- **ZN** — substrate zone name

## Profile history

A tab bar above the chart lets you switch back to profiles you drew earlier in the same session.

## Exporting the profile

Click the **Export** button in the top-right of the profile panel and choose:

- **PNG** — saves a rasterised image of the chart (including the substrate strip).
- **CSV** — saves a comma-separated file with columns: `distance_m`, `depth_m`, `slot`, `lon`, `lat`.
  - `slot` is the numeric substrate index: 0 = Sand, 1 = Sediment, 2 = Silt, 3 = Basalt.

## Temperature & thermocline

Water column temperature data is available separately from the depth profile. Look for the **TEMP** chip in the HUD; clicking it opens the [Temperature Profile Chart](#article:temperature-profile) panel, which shows temperature vs depth using Argo float, CTD cast, or NCEI reanalysis data for your current location.

## Closing the profile

Click the **×** in the top-right of the profile panel to dismiss it. The measurement line on the terrain is also removed.

## When to use this

- Planning a transect run for a real boat.
- Checking whether a route crosses a hazard or a ledge.
- Comparing slope steepness between two regions.
- Quickly sanity-checking a depth claim from a paper chart.

## Saving and replaying routes

Multi-waypoint path profiles can be saved as named routes and flown back as animated camera flythroughs. See [Saved Routes](#article:saved-routes) for the full workflow.
