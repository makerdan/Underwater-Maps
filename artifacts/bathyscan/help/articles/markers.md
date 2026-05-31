---
id: markers
title: Markers
section: Features
order: 5
---

# Markers

Markers are persistent pins you drop on the seafloor to remember a spot. They appear on both the 3D scene and the [Overview Map](#article:overview-map) and survive between sessions.

## Dropping a marker

![Press G, fill the Drop Marker form, save](/help/marker-drop.gif)

1. Enter **Fly mode** by clicking the scene (or press **Tab**).
2. Aim the crosshair at the target location.
3. Press **G**, or right-click (or press **Q**) to open the terrain context menu and choose **Drop GPS pin here**.
4. The **Drop Marker** form appears with longitude, latitude, and depth pre-filled.
5. Choose a **Type**, fill in a **Label**, optionally add notes, and click **Save Marker**.

## Marker types

The available types change with the active water environment.

**Saltwater:** Fish School, Reef, Wreck, Hazard, Anchorage, Depth Pole, Custom.

**Freshwater:** Vegetation, Structure, Hazard, Launch, Depth Pole, Custom.

Each type has its own icon and colour so you can scan them at a glance on the overview map.

## Depth poles

Choose **Depth Pole** when you want a tall vertical line that is visible from far away. You pick the colour at save time. Useful for marking a depth contour you want to follow or a drop you plan to return to.

## Managing markers in the list

Open the **▼ MARKERS** accordion inside the Datasets panel to see every marker for the current dataset. The list includes a search box and type-filter buttons to help narrow a long list.

From the list you can:

- **Click** a marker row to teleport to it (fly mode) or centre the orbit camera on it (orbit mode).
- Hover to reveal **✏** (edit) and **×** (delete) controls.

### Deleting a marker

Clicking **×** immediately removes the marker from the scene. A brief **undo toast** appears at the bottom of the screen with an **Undo** option. If you click Undo within 5 seconds the marker is restored. If the toast expires, the deletion is sent to the server and is permanent.

## Dataset folders

The **Datasets panel** supports a folder tree for organising your saved datasets. Folders are separate from the marker list — they organise datasets, not individual markers.

- **Create a folder:** Right-click in the dataset tree or use the context menu → **New folder inside**.
- **Rename a folder:** Context menu → **Rename**.
- **Delete a folder:** Context menu → **Delete**. A 5-second undo window works the same way as marker deletion.
- **Move datasets into folders:** Drag a dataset row onto a folder, or drag it back to the root level.

## GPX / KML export

To export your markers and trolling routes:

1. In the Datasets panel, look for the **▲ EXPORT GPS…** button in the Markers section.
2. Choose **GPX** or **KML** and download.

GPX is compatible with Garmin, Navionics, and most chart plotters. KML opens in Google Earth.

> **Note:** The export includes markers (as waypoints) and any saved trolling routes. Live GPS breadcrumb trails are stored separately on the server and are not included in this export.

## GPX / KML import

To import waypoints from an external device or chart plotter:

1. Click the **▼ IMPORT GPS…** button in the Markers section.
2. Drop in a `.gpx`, `.kml`, `.kmz`, or `.csv` file.
3. A preview map shows the incoming points filtered to the active dataset's bounding box. You can edit names and assign types before importing.

Individual points become **markers**; routes and tracks become **trolling presets** in the Drift Planner.

## Offline behaviour

If you drop a marker while offline, it is queued locally and synced as soon as you reconnect. You will see a pending count displayed while markers are waiting to upload.

Markers are tied to the dataset — switching datasets shows a different list.
