---
id: gps-trail-recorder
title: GPS & Trail Recorder
section: Features
order: 13
showQA: true
---

# GPS & Trail Recorder

The GPS Trail Recorder uses your device's location to lock the 3D camera to your real-world position and record a breadcrumb trail of where you have been. It is designed for use on the water — mount a tablet or laptop on the helm, enable Follow Me, and BathyScan tracks along with you.

## Enabling Follow Me GPS lock

1. Click the **Dive to GPS** button in the top-left HUD (visible when a GPS fix is available).
2. Your browser will ask for location permission — click **Allow**.
3. The camera immediately moves to your GPS coordinates and the mode badge changes to **◉ GPS**.
4. As your device moves, the 3D camera follows, keeping you centred in the view.

While Follow Me is active you can still adjust altitude (Space / Shift) and camera heading, but lateral position is locked to GPS.

To exit Follow Me, press **Esc** or click the **Unlink GPS** button that replaces the Dive to GPS button.

## Breadcrumb trail

When Follow Me is active, BathyScan automatically records your track as a **breadcrumb trail** — a polyline drawn on both the 3D terrain and the [Overview Map](#article:overview-map).

- Points are sampled at the interval you configure (see GPS & Trail settings below).
- The trail colour is configurable in Settings → GPS & Trail.
- Recorded trails are uploaded to the server in the background. When offline, points are buffered locally and sent when you reconnect.

## GPS & Trail settings

All GPS trail settings are under **Settings → GPS & Trail**:

| Setting | Options | What it does |
| --- | --- | --- |
| Auto-Start Trail Recording | On / Off | Automatically begins recording when a dataset loads |
| Recording Interval | 1 Hz (1 s), 0.5 Hz (2 s), 0.1 Hz (10 s) | How often a new trail point is sampled. Default: 0.1 Hz (every 10 s) |
| Trail Colour | Colour picker | Colour of the breadcrumb trail line |
| Trail Retention | 7 days / 30 days / 90 days / Forever | How long recorded trails are kept before automatic purge |

## Exporting markers and trolling routes (GPS Export)

In the Datasets panel, the **▲ EXPORT GPS…** button lets you export your **markers** (as GPX waypoints) and any saved **trolling routes** to GPX or KML. This is the primary GPS export for sharing data with chart plotters.

> **Note:** Recorded breadcrumb trail data is stored server-side but is not currently included in the GPS Export dialog.

## Importing GPS files

The **▼ IMPORT GPS…** button in the Datasets panel accepts `.gpx`, `.kml`, `.kmz`, and `.csv` files. After upload:

- Individual waypoints become **markers** — you can set types and edit names in the preview step.
- Routes and tracks become **trolling presets** in the [Drift Planner](#article:drift-planner).

## Tips

- For the most accurate GPS lock, use a device with a dedicated GPS chip (tablets with LTE, or a laptop with an external USB GPS receiver). Browser geolocation on a Wi-Fi-only device falls back to IP-based positioning, which is too inaccurate for on-water use.
- Use a faster recording interval (1 Hz) when trolling slowly past structure to get a detailed track; use 0.1 Hz for long open-water transits to keep data volume down.
- Pair the trail recorder with the **Depth Profile** tool after a run — draw a profile along the route you covered to review the terrain under your transect.
- If the GPS arrow jumps erratically, your device may be using a Wi-Fi or cell-tower fix. Check your device's location settings and make sure high-accuracy GPS mode is enabled.
- The trail is tied to the active dataset. Switching datasets pauses trail recording.
