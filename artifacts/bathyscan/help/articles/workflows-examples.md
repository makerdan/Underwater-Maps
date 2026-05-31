---
id: workflows-examples
title: Workflows & Examples
section: Workflows
order: 11
---

# Workflows & Examples

End-to-end recipes for common BathyScan tasks. Each walks you from a blank screen to a finished result.

## Recipe 1: Find a fishing spot from scratch

1. Set the **Environment** toggle (top of Datasets panel) to Saltwater or Freshwater.
2. Pick a built-in dataset close to where you fish.
3. Open the **Habitat Layer** panel and select your target species (e.g. *Rockfish*).
4. The terrain takes on an amber overlay where suitability is high. The panel lists the top hotspots ranked by score.
5. Click **Fly There** on the top hotspot. The camera dives to it.
6. Check the depth, zone label, and bottom-left PIN readout.
7. Press **G** to drop a marker so you can come back.

## Recipe 2: Import your own bathymetry

1. Export your sonar data as a `.csv` with three columns: longitude, latitude, depth.
2. Open the Datasets panel and click **Upload**.
3. Drag your file in. Wait for the spinner.
4. The terrain renders, zones are classified, and the dataset is saved under **Your saved datasets**.
5. Drop a few markers at known landmarks to sanity-check the alignment.

## Recipe 3: Mark and classify a zone

1. Load a dataset.
2. Open the **Zone overlay** panel and turn it on.
3. Look for a patch the AI got wrong — for instance, a known reef showing up as sand.
4. Click **Paint** to enter paint mode.
5. Pick the correct zone (e.g. *coral_reef_potential*).
6. Brush over the wrong cells.
7. Click **Save**. The correction sticks for that dataset.

## Recipe 4: Ask the AI for habitat insights

1. Press **`/`** to open the Query panel.
2. Type: *"Where would I find rockfish habitat in this dataset?"*
3. The AI highlights matching zones and describes promising areas.
4. Fly to one of the highlighted cells.
5. Right-click → **Describe this spot** for a short geological explanation.
6. Drop a marker if it looks promising.

## Recipe 5: Plan a transect with a depth profile

1. Fly to your planned start point.
2. Right-click → **Start straight-line profile**.
3. Fly (or orbit) to the end point, right-click → **End depth profile here**.
4. The **Depth Profile** panel appears along the bottom with length, min/max depth, and the substrate strip.
5. Click **Export → CSV** to save the profile data for later analysis.
6. If the profile crosses a hazard, adjust the route and remeasure.

## Recipe 6: Plan a drift and trolling run

1. Open the **Drift Planner** in the left side panel.
2. Set your start position and drift duration. Click **Calculate** to see the predicted drift track on the overview map.
3. Switch to **Trolling mode**. Set your trolling speed (knots) and heading.
4. Click **+ Add Waypoint** and click the predicted drift endpoint on the overview map — this becomes your first powered waypoint.
5. Add more waypoints to build a full trolling route back to your start.
6. Review the leg-distance and estimated time for each leg.
7. Adjust speed or heading until the times fit your fishing window.

## Recipe 7: Check weather and tidal windows before a trip

1. Load the dataset for your target area (saltwater mode).
2. In the **Overlays panel** (left sidebar), click **🛩 NOAA WEATHER STATIONS** to show weather station pins.
3. Click the nearest station pin and read the wind, ceiling, and visibility in the popover.
4. Open the **Tidal Overlay** panel and flick through the day buttons to find days with well-timed slack windows (look for the `◐N` badge).
5. Drag the hour slider to the hour you plan to fish and read the predicted current speed and direction.
6. Use that current direction as input for the Drift Planner.

## Recipe 8: Record and track a GPS run

1. Arrive at your fishing area with BathyScan open on a helm-mounted device.
2. Click **Dive to GPS** (top-left HUD) and allow location access. The camera locks to your GPS position.
3. Fish your drift. BathyScan records a breadcrumb trail automatically on the overview map.
4. To share your markers and trolling routes with a chart plotter after the trip, open the Datasets panel → Markers section → **▲ EXPORT GPS…** → GPX.

## Recipe 9: Organise markers into folders

1. After a season of fishing, note that datasets (not individual markers) live in the folder tree.
2. In the Datasets panel, right-click (or use the context menu) → **New folder inside** to create a folder (e.g. "Spring Rockfish", "Halibut Holes").
3. Drag existing datasets into the appropriate folder.
4. Use **▲ EXPORT GPS…** to export the markers from each loaded dataset as GPX for different use cases.
