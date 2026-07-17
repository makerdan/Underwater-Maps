---
id: drive-boat
title: Drive Boat
section: Features
order: 8.6
---

# Drive Boat

**Drive Boat** mode lets you navigate the 3D scene at a realistic boat speed, with an optional heading-lock autopilot that steers you along a bearing or follows a saved Drift Planner route. It is designed for planning trolling runs, estimating transit times, and visualising a trip before you make it on the water.

## Step 1 — Enable Realistic Speed Mode

1. Go to **Settings → Camera & Controls**.
2. Turn on **Realistic Speed Mode**.

The HUD speed indicator changes from unitless dot-tiers to **knots**. The Throttle panel becomes the primary speed control.

Alternatively, you can toggle Realistic Speed Mode from a button in the HUD without opening Settings.

## Step 2 — Open the Throttle panel

Switch to the **Plan tab** in the left sidebar. The **Throttle** section appears below the Drift Planner.

Set your speed using any of the controls:

- **Lever** — drag the cyan thumb up or down the track.
- **Tick-mark presets** — click a labelled speed to snap to it instantly.
- **Number input** — type an exact MPH value and press Enter.

The HUD `SPD` readout and any Drift Planner trolling calculations update immediately.

## Step 3 — Read the distance-traveled counter

While Drive Boat is active, a **distance-traveled counter** appears in the HUD (bottom-left, below the speed indicator). It shows the cumulative distance traveled in your current session in nautical miles. Reset it by clicking the counter label or by starting a new planner session.

## Step 4 — Engage heading lock (autopilot)

Heading lock keeps you on a compass bearing without continuous input.

1. With a speed set, click **Lock Heading** in the Throttle panel (or the lock icon in the HUD).
2. The heading input (in degrees) sets your course — **0°** is north, **90°** is east, and so on.
3. The camera steers automatically. Adjust the heading input at any time to change course without unlocking.
4. Click **Unlock** or press **Esc** to disengage and return to manual control.

> **Tip:** heading lock works in both Orbit and Fly camera modes. In Fly mode the camera faces your heading; in Orbit mode the boat moves along the bearing while the camera stays free.

## Step 5 — Follow a saved Drift Planner route

If you have a multi-waypoint plan saved in the Drift Planner:

1. Load it from the **Saved Plans** dropdown in the Drift Planner section.
2. Click **Follow route** in the Throttle panel.
3. The autopilot steers waypoint-to-waypoint at your set speed, updating the heading automatically at each leg transition.
4. A progress indicator shows which leg you are on and how far to the next waypoint.

To stop following the route, click **Stop** or press **Esc**.

## Tips

- Set a realistic trolling speed (typically 2–4 knots) when following a bottom-fishing route — the Drift Planner leg-time estimates are based on this speed.
- Use **heading lock** with the **Near-btm current layer** on to see how tidal set will push you off your intended track.
- The distance counter is useful for estimating how much ground you cover in a drift — compare it to your target drift length before committing to a spot.
- Combine Drive Boat with the Depth Profile tool: run your planned transect once in Drive Boat mode to see the terrain, then drop profile measurements at points of interest before the real trip.
