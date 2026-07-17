---
id: drift-planner
title: Drift Planner
section: Features
order: 8
---

# Drift Planner

The Drift Planner helps you model how your boat will move relative to the seafloor — whether you are drifting with the engine off, trolling at a steady speed, or following a sequence of waypoints.

## Opening the planner

Switch to the **Plan tab** in the left sidebar. The **Drift Planner** section is listed below the Tidal panel. Toggle it on to activate the planner controls and display the predicted track on the overview map.

## Setting a start point

By default the planner uses your current GPS fix as the start point. If you do not have a GPS lock, or want to plan from a different location:

1. Click **Set start point** in the Drift Planner panel.
2. Click any point on the 3D scene or the overview map.

A **Drift Start** marker appears at the chosen origin so you can compare your real position to the plan later.

## Drift mode

In **Drift mode** the planner estimates where your boat will end up after a given time based solely on wind and current:

- **Start position** — your current GPS fix, or a pin you have dropped.
- **Drift duration** — how many minutes you want to drift for.
- **Fishing line length** (optional) — estimates where your bait will settle relative to the boat after drifting.

The planner draws a predicted ending position and a faint trail.

> **Heads-up:** this is a simple linear model. Eddies, depth-driven currents, and shoreline effects are not modelled. Use it as a sanity check, not a navigation source.

## Trolling mode

Switch to **Trolling mode** to simulate powered movement at a constant speed:

- **Speed (knots)** — your trolling speed through the water. Set it precisely with the [Throttle Panel](#article:throttle). The planner accounts for the current layer you have selected in the Tidal Overlay panel, so your speed over ground will differ from speed through water when there is a cross-current.
- **Heading (°)** — compass bearing you will hold. Set **0°** for north, **90°** for east, and so on.

The scene shows your predicted track as a line on the overview map. As you adjust speed and heading the track updates in real time.

### Combining drift and trolling

You can run **both modes in sequence** to plan a drifting approach followed by a powered retrieval — or vice versa:

1. Set a drift segment first (engine off, wind/current carry).
2. Enable trolling at the predicted drift endpoint and set a heading back to your start.

The combined track is shown as two connected segments with a colour change at the transition point.

## Adjusting wind and tidal inputs

The planner reads wind direction and speed from the active **Weather Panel** conditions, and tidal current from the **Tidal Overlay** panel's selected layer and time. To change the inputs:

- Adjust the hour slider in the Tidal panel to model a future or past state of the tide.
- Switch the current layer (Surface / Mid-col / Near-btm) to match your gear depth.
- If no live weather is available, you can manually enter a wind speed and bearing in the Drift Planner panel's **Override wind** fields.

The drift path updates immediately whenever these inputs change.

## Waypoints

Waypoints let you string together a series of targets that the planner visits in order:

1. Click **+ Add Waypoint** in the Drift Planner panel.
2. Click a point on the overview map, or type coordinates, to place the waypoint.
3. Add more waypoints. The planner draws legs between them and shows the **leg distance** (in nautical miles) and **estimated time** for each leg based on your current trolling speed and heading.
4. The total route distance and total estimated time appear at the bottom of the waypoint list.

You can drag waypoints to reorder them, or click **×** to remove one. Click any waypoint row to move the camera to that point.

## Editing waypoints

After placing waypoints you can:

- **Drag** a waypoint pin on the overview map to reposition it.
- **Click a waypoint row** in the list and type new coordinates directly.
- **Reorder** by dragging the ≡ handle on any row.
- **Delete** a single waypoint with the **×** button on its row.

The leg distances and estimated times update instantly as you edit.

## Saving and loading plans

Click **Save plan** at the bottom of the Drift Planner panel to give the current waypoint route a name and store it. Saved plans appear in the **Saved Plans** dropdown at the top of the panel. Select one to reload it.

Plans are stored per-account and available across devices. They are not tied to a specific dataset — the same plan can be loaded while viewing any dataset.

## GPX export

Click **Export GPX** (below the waypoint list) to download the full route — start point, drift/trolling segments, and all waypoints — as a standard GPX file. You can open this in any chart plotter, navigation app, or GIS tool that reads GPX.

## WeatherPanel conditions summary

At the top of the Drift Planner section a compact **WeatherPanel** summary shows the current wind speed, direction, and gust speed being fed into the drift calculation. If conditions have been overridden manually, the summary shows the override values instead of live data.

## Tips

- Pair drift mode with the **Near-bottom current layer** when fishing with heavy jigs or downriggers — near-bottom flow often differs significantly from the surface.
- For long drifts, re-check the wind and current data mid-session as conditions change throughout the day.
- Use the leg-distance readout in waypoint mode to confirm you can reach the next mark within your planned fishing window.
- The **SIMULATED badge** on tidal arrows means modelled data is being used for the current calculation — drift predictions are still directionally useful but treat absolute distances as estimates.
- Save a named plan for each of your regular fishing spots. Loading a saved plan takes seconds and saves you having to re-enter waypoints every trip.
