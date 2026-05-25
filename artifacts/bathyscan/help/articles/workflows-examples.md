---
id: workflows-examples
title: Workflows & Examples
section: Workflows
order: 11
---

# Workflows & Examples

End-to-end recipes for common BathyScan tasks. Each walks you from a blank screen to a finished result.

## Recipe 1: Find a fishing spot from scratch

1. Make sure the **Environment** toggle (top of Datasets panel) matches what you want — Saltwater or Freshwater.
2. Pick a built-in dataset close to where you fish.
3. Open the **Habitat Layer** panel and select your target species (e.g. *Rockfish*).
4. The terrain takes on an amber overlay where suitability is high. The panel lists the top hotspots ranked by score.
5. Click **Fly There** on the top hotspot. The camera dives to it.
6. Look at the bottom-left **PIN** and depth, and the zone label.
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
3. The AI highlights matching zones and may say something like *"Look at the basalt rock cells along the western shelf, especially between 40 m and 80 m."*
4. Fly to one of the highlighted cells.
5. Right-click → **Describe this spot** for a short geological explanation.
6. Drop a marker if it looks promising.

## Recipe 5: Plan a transect with a depth profile

1. Fly to your planned start point.
2. Right-click → **Measure from here**.
3. Fly (or orbit) to the end point and click.
4. The **Depth Profile** panel appears along the bottom with length, min/max depth, and the substrate strip.
5. If the profile crosses a hazard, adjust the route and remeasure.
