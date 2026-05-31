---
id: drift-planner
title: Drift Planner
section: Features
order: 8
---

# Drift Planner

The Drift Planner helps you model how your boat will move relative to the seafloor — whether you are drifting with the engine off, trolling at a steady speed, or following a sequence of waypoints.

## Opening the planner

Look for the **Drift Planner** entry in the side pane (below Habitat Layer). Toggle it on to activate the planner controls and display the predicted track on the overview map.

## Drift mode

In **Drift mode** the planner estimates where your boat will end up after a given time based solely on wind and current:

- **Start position** — your current GPS fix, or a pin you have dropped.
- **Drift duration** — how many minutes you want to drift for.
- **Fishing line length** (optional) — estimates where your bait will settle relative to the boat after drifting.

The planner draws a predicted ending position and a faint trail. A **Drift Start** marker at the origin lets you compare your real drift to the prediction later.

> **Heads-up:** this is a simple linear model. Eddies, depth-driven currents, and shoreline effects are not modelled. Use it as a sanity check, not a navigation source.

## Trolling mode

Switch to **Trolling mode** to simulate powered movement at a constant speed:

- **Speed (knots)** — your trolling speed through the water. The planner accounts for the current layer you have selected in the Tidal Overlay panel, so your speed over ground will differ from speed through water when there is a cross-current.
- **Heading (°)** — compass bearing you will hold. Set **0°** for north, **90°** for east, and so on.

The scene shows your predicted track as a line on the overview map. As you adjust speed and heading the track updates in real time.

### Combining drift and trolling

You can run **both modes in sequence** to plan a drifting approach followed by a powered retrieval — or vice versa:

1. Set a drift segment first (engine off, wind/current carry).
2. Enable trolling at the predicted drift endpoint and set a heading back to your start.

The combined track is shown as two connected segments with a colour change at the transition point.

## Waypoints

Waypoints let you string together a series of targets that the planner visits in order:

1. Click **+ Add Waypoint** in the Drift Planner panel.
2. Click a point on the overview map, or type coordinates, to place the waypoint.
3. Add more waypoints. The planner draws legs between them and shows the **leg distance** (in nautical miles) and **estimated time** for each leg based on your current trolling speed and heading.
4. The total route distance and total estimated time appear at the bottom of the waypoint list.

You can drag waypoints to reorder them, or click **×** to remove one. Waypoints are saved per dataset session and cleared when you start a new planner session.

## Tips

- Pair drift mode with the **Near-bottom current layer** when fishing with heavy jigs or downriggers — near-bottom flow often differs significantly from the surface.
- For long drifts, re-check the wind and current data mid-session as conditions change throughout the day.
- Use the leg-distance readout in waypoint mode to confirm you can reach the next mark within your planned fishing window.
- The **SIMULATED badge** on tidal arrows means modelled data is being used for the current calculation — drift predictions are still directionally useful but treat absolute distances as estimates.
