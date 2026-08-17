---
id: gps-trail-recorder
title: GPS & Trail Recorder
section: Features
order: 13
showQA: true
---

# GPS & Trail Recorder

The GPS Trail Recorder uses your device's location to lock the 3D camera to your real-world position and record a breadcrumb trail of where you have been. It is designed for use on the water — mount a tablet or laptop on the helm, enable Follow Me, and BathyScan tracks along with you.

## Opening the trail recorder

The trail recorder lives inside the **Live tab** of the left sidebar. Tap **Live** in the sidebar header to open it. From there you can:

- Name your trail before you start recording.
- Pick a colour from the palette.
- Set the sampling interval.
- Start, stop, resume, or discard a recording.

If a recording is running and you switch to another sidebar tab (Explore, Plan, etc.), a small **⏺ REC** chip appears in the bottom-right of the viewport. Tapping the chip takes you straight back to the Live tab so you can stop or review the recording.

## Enabling Follow Me GPS lock

1. Open the **Live** tab in the left sidebar.
2. Your browser will ask for location permission — click **Allow**.
3. The camera immediately moves to your GPS coordinates and the **Follow Me** button activates.
4. As your device moves, the 3D camera follows, keeping you centred in the view.

While Follow Me is active you can still adjust altitude (Space / Shift) and camera heading, but lateral position is locked to GPS.

To exit Follow Me, click the **◉ Following You** button in the Live tab to toggle it off.

## Breadcrumb trail

When you start recording in the Live tab, BathyScan logs your track as a **breadcrumb trail** — a polyline drawn on both the 3D terrain and the [Overview Map](#article:overview-map).

- Points are sampled at the interval you choose in the Live tab (5 s / 10 s / 30 s / 60 s).
- The trail colour is set in the Live tab before you start recording, or in Settings → GPS & Trail for your default.
- Recorded trails are uploaded to the server in the background. When offline, points are buffered locally and sent when you reconnect.

## GPS & Trail settings

All GPS trail settings are under **Settings → GPS & Trail**:

| Setting | Options | What it does |
| --- | --- | --- |
| Auto-Start Trail Recording | On / Off | Automatically begins recording when entering Live mode |
| Recording Interval | 5 s / 10 s / 30 s / 60 s | How often a new trail point is sampled. Default: 10 s |
| Trail Colour | Colour picker | Default colour for new trails |
| Trail Retention | 7 days / 30 days / 90 days / Forever | How long recorded trails are kept before automatic purge |

## Exporting markers, routes, and trails (GPS Export)

In the Datasets panel, the **▲ EXPORT GPS…** button lets you export your **markers** (as GPX waypoints), any saved **trolling routes**, and your **recorded breadcrumb trails** to GPX or KML. This is the primary GPS export for sharing data with chart plotters.

To include a recorded trail, tick it in the **Recorded Trails** section of the export dialog. Each selected trail is written as a GPX `<trk>` track with timestamped track points, which chartplotters and tools like Garmin BaseCamp read as a voyage track. Trails are listed for the active dataset only, and respect your Trail Retention setting.

## Importing GPS files

The **▼ IMPORT GPS…** button in the Datasets panel accepts `.gpx`, `.kml`, `.kmz`, and `.csv` files. After upload:

- Individual waypoints become **markers** — you can set types and edit names in the preview step.
- Routes and tracks become **trolling presets** in the [Drift Planner](#article:drift-planner).

## Tips

- For the most accurate GPS lock, use a device with a dedicated GPS chip (tablets with LTE, or a laptop with an external USB GPS receiver). Browser geolocation on a Wi-Fi-only device falls back to IP-based positioning, which is too inaccurate for on-water use.
- Use a faster recording interval (5 s) when trolling slowly past structure to get a detailed track; use 60 s for long open-water transits to keep data volume down.
- Pair the trail recorder with the **Depth Profile** tool after a run — draw a profile along the route you covered to review the terrain under your transect.
- If the GPS arrow jumps erratically, your device may be using a Wi-Fi or cell-tower fix. Check your device's location settings and make sure high-accuracy GPS mode is enabled.
- The trail is tied to the active dataset. Switching datasets pauses trail recording.
