---
id: plan-mode
title: Plan Mode Walkthrough
section: Workflows
order: 2
---

# Plan Mode Walkthrough

The **Plan tab** brings together everything you need to plan a trip on the water: tidal conditions, drift and route planning, and realistic boat-speed simulation. Switch to it by clicking **Plan** at the top of the left sidebar.

## Tidal panel

The **Tidal panel** shows real-time and predicted tidal conditions for the area on screen.

### What you can see

- **Tide height** — current water level relative to MLLW. A `PREDICTED` badge appears when values come from the harmonic forecast rather than a live gauge.
- **Direction & speed** — tidal current direction and speed in knots, plus a Flooding / Ebbing / Slack status line.
- **Next event** — countdown to the next high or low tide.
- **Slack windows** — purple bands along the hour slider show when current is near zero. The day picker shows a `◐N` badge counting slack windows per day.

### Scrubbing time

Use the **day buttons** and the **hour slider** below them to jump the scene to a different moment. All arrows, the height readout, and the status line update together. Click **Today** at the current hour to return to live mode.

### Switching current layers

The three buttons under **Current layer** switch the on-scene arrows between **Surface**, **Mid-col** (mid-column), and **Near-btm** (near-bottom). Each layer has its own Arrow Density slider.

## Drift Planner

The **Drift Planner** section sits below the Tidal panel. See the [Drift Planner](#article:drift-planner) article for a complete walkthrough. Summary steps:

1. **Set a start point** — uses your GPS fix by default, or click a point on the scene.
2. **Choose a mode** — Drift (engine off, wind/current carry) or Trolling (powered at a set speed and heading).
3. **Add waypoints** — click **+ Add Waypoint** and click points on the overview map to build a multi-leg route.
4. **Edit and reorder** — drag waypoint pins on the map or reorder rows with the ≡ handle.
5. **Save the plan** — click **Save plan**, give it a name, and it persists across sessions.
6. **Export as GPX** — click **Export GPX** to download the route for use in any chart plotter or navigation app.

The drift path updates in real time as you change tidal layer, time, or wind inputs.

## Throttle / Drive Boat panel

The **Throttle panel** sets your boat's simulated speed and, when heading lock is engaged, steers automatically.

### Setting your speed

1. Enable **Realistic Speed Mode** in **Settings → Camera & Controls** (or toggle it directly from the HUD). The speed indicator switches to knots.
2. Open the **Throttle panel** in the Plan tab.
3. Drag the **lever** up or down, click a **tick-mark preset**, or type an exact MPH value in the number input.

The HUD `SPD` readout and the Drift Planner trolling calculations both update immediately.

### Engaging heading lock (autopilot)

1. With a speed set and Realistic Mode on, click **Lock Heading** in the Throttle panel (or the heading-lock button in the HUD).
2. The camera steers automatically in the direction you set. Use the heading input (in degrees) to change course without unlocking.
3. Click **Unlock** or press **Esc** to disengage.

### Following a saved Drift Planner route

1. Load a saved plan from the Drift Planner **Saved Plans** dropdown.
2. Click **Follow route** in the Throttle panel.
3. The autopilot steers from waypoint to waypoint at your set speed, updating the heading at each leg transition.

## Tips

- Use the Tidal panel's day picker to find a day with a slack window at your planned fishing time — the `◐N` badge makes this quick.
- Combine a drift segment (engine off) and a trolling segment to simulate a full pass: drift downcurrent then troll back upwind.
- Adjust the **Near-btm** current layer when planning jig or downrigger passes — near-bottom flow often differs substantially from surface readings.
- Heading lock works in both Fly mode and Realistic Speed mode; the camera follows the boat heading.
