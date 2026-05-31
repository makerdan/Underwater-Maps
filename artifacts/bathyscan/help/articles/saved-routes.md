---
id: saved-routes
title: Saved Routes
section: Features
order: 7.5
showQA: true
---

# Saved Routes

A **saved route** is a named sequence of depth waypoints captured from the [Depth Profile](#article:depth-profile) panel. Routes let you replay a transect at any time, animate a flythrough along it, or share a planned survey path with crew.

## Creating a route

1. Draw a **path profile** in the 3D scene: right-click → **Start path profile**, add intermediate waypoints with right-click → **Add waypoint here**, then right-click → **Finish path here**.
2. The Depth Profile panel opens at the bottom of the screen with the completed path.
3. Click **Save as Route** (only available on non-simulated terrain).
4. Give the route a name and confirm.

The route is saved to the server and appears immediately in the **Routes** section of the sidebar.

> **Tip:** Straight-line A-to-B profiles do not have a **Save as Route** button — only multi-waypoint path profiles can be saved.

## The Routes panel

The **▼ ROUTES** accordion is in the left sidebar, below the Depth Profile section. It lists every route saved for the current dataset, showing:

- Route name
- Number of waypoints
- Total distance

### Rename a route

Click the **✏** (edit) icon on any route row. The name field becomes editable in-line. Press **Enter** or click away to save, or press **Escape** to cancel.

### Delete a route

Click the **×** icon on a route row. A confirmation dialog appears before the route is permanently removed from the server.

### Flying a route

Click **▶ FLY** on any route row to launch an animated camera flythrough along the saved waypoints. The camera glides through each waypoint in order at a steady pace, following the seafloor contour.

While flying:

- Click **■ STOP** (or press **Escape**) to end the flythrough early.
- The scene returns to normal Fly / Orbit mode after the route finishes or is stopped.

Only one route can play at a time; starting a new flythrough automatically stops the previous one.

## Routes and the Overview Map

Saved routes appear as cyan polylines on the [Overview Map](#article:overview-map) when the map is open, so you can see the full planned path from above before flying it.

## Relationship to Drift Planner trolling presets

The Drift Planner stores **trolling presets** (horizontal surface routes used for fishing drift simulation). Saved routes live in the Routes panel and are used for 3D flythroughs of the seafloor, not for drift calculations. The two systems are independent. See [Drift Planner](#article:drift-planner) for surface route planning.

## Offline behaviour

Routes are stored on the server and require a connection to load or save. If you are offline when you attempt to save a route, the action fails and you will see an error toast. The depth profile itself is still visible — reconnect and click **Save as Route** again.
