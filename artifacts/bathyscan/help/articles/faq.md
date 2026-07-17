---
id: faq
title: FAQ
section: Reference
order: 13
---

# Frequently Asked Questions

## Where does the depth data come from?

Built-in datasets are sourced from public agencies — mostly GEBCO for the open ocean, NOAA for US coastal waters, and individual lake bathymetry projects for freshwater. Each dataset has a provenance box that tells you the exact source, resolution, and collection date.

## How accurate is the AI zone classification?

Good for getting the gist, not for survey-grade decisions. The model looks at depth shape and slope but cannot see substrate directly. Treat it as a strong hint and use [Paint mode](#article:zones-paint-mode) to correct anything you know better.

## Can I use BathyScan offline?

Yes, to an extent. Datasets you have already loaded are cached and stay available offline. Markers you drop while offline are queued locally and uploaded when you reconnect. GPS trail segments recorded offline are also buffered locally and synced when you are back online. You will see an **OFFLINE** badge in the top-right when offline mode is active.

## Does it work on a phone?

It works, but a desktop with a mouse is the better experience. On touch devices you get a virtual joystick instead of WASD, and the Help window opens as a full-screen sheet.

## How do I use the context menu on a phone or tablet?

Instead of right-clicking, use **tap-and-hold** on the terrain or on any dataset or folder entry in the sidebar. Hold for about one second and the context menu opens, giving you the same options as a right-click (Drop GPS pin, Measure, Rename, Move to folder, etc.).

## Are my markers and uploads private?

Yes. Markers, uploaded datasets, and GPS trails are tied to your account and only visible to you.

## Why do I sometimes hit an AI rate limit?

Each user shares one quota across all AI features (classify, describe, query, help Q&A). It resets every minute. If you hit the limit, wait about 30 seconds and try again.

## Can I export my data?

Yes:

- **Depth profiles** — export as PNG (chart image) or CSV (`distance_m`, `depth_m`, `slot`, `lon`, `lat`) using the **Export** button in the profile panel.
- **Markers and trolling routes** — use the **▲ EXPORT GPS…** button in the Datasets panel Markers section to download as GPX or KML.
- **Settings** — use **Settings → Offline & Storage → Export Settings** to download a `.json` backup of your entire settings configuration. You can import it on another device or after a reinstall using **Import Settings** in the same section.

See [Depth Profile](#article:depth-profile) and [Markers](#article:markers) for details.

## Can I import waypoints from my chart plotter?

Yes — use the **▼ IMPORT GPS…** button in the Datasets panel Markers section. It accepts `.gpx`, `.kml`, `.kmz`, and `.csv` files. Individual points become markers; routes and tracks become trolling presets. See [GPS & Trail Recorder](#article:gps-trail-recorder) for details.

## How do I change units to imperial?

Settings → HUD → Units → Imperial.

## What does the Q key do?

Pressing **Q** (or right-clicking the terrain, or **tap-and-holding** on touch) opens the **Crosshair Action Menu** at the current terrain point. It contains: Drop GPS pin, Measure, Depth Profile, Set as home position, Save view as bookmark, Copy coordinates, and Copy share link.

## How do I see weather at a location?

Click **🛩 NOAA WEATHER STATIONS** or **🌿 RAWS WEATHER STATIONS** in the Overlays panel (left sidebar, Explore tab) to show weather station pins. Click any pin for a popover showing wind, visibility, ceiling, temperature, and observation time. See [Weather Stations](#article:weather-stations) for details.

## How do I open the overview map?

Press **O**, or click **🗺 OVERVIEW** in the Overlays panel (left sidebar, Explore tab). See [Overview Map](#article:overview-map) for details.

## How do I switch between Explore, Plan, and Analyze modes?

Click the **Explore**, **Plan**, or **Analyze** tab labels at the top of the left sidebar. Each tab shows the panels relevant to that workflow. See the [Explore Mode](#article:explore-mode), [Plan Mode](#article:plan-mode), and [Analyze Mode](#article:analyze-mode) walkthroughs for step-by-step guides.

## How do I report a bug or request a feature?

Use the email link at the bottom of any help article.
