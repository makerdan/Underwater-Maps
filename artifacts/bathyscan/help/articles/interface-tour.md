---
id: interface-tour
title: Interface Tour
section: Getting Started
order: 2
---

# Interface Tour

A quick map of every visible part of the BathyScan screen.

## Top bar

- **BATHYSCAN** logo on the left — click to return to the default view.
- **Help** button — opens this window.
- Your email, **Settings** (or press **,**), and **Sign out** on the right.

## 3D scene

The centre of the screen is the live 3D terrain. A reticle and crosshair sit in the middle to show what you are pointing at.

![Full screen with HUD overlays](/help/full-screen.png)

## HUD overlays

These float above the 3D scene and are organised by corner:

- **Top-left** — Mode badge (**◎ ORBIT** or **● FLY**), compass heading (HDG), and a Dive-to-GPS button when a GPS lock is available.
- **Top-right** — Offline indicator and cached-data badge (only when offline).
- **Centre** — Crosshair with longitude, latitude, and depth under the cursor.
- **Bottom-left** — Camera depth, speed indicator (dots = speed tier), and the last pin you dropped.

Most HUD elements can be turned off or made transparent under **Settings → HUD**.

## Left sidebar

The left side of the screen holds a vertically scrollable column organised into **three mode tabs** at the top:

- **Explore** — browse and switch datasets, control environmental overlays, search the data catalogue, and access the Find Data panel.
- **Plan** — access the Tidal panel (tide height, time scrub, slack windows), the Drift Planner (routes, waypoints, GPX export), and the Throttle / Drive Boat panel (speed control and heading lock).
- **Analyze** — access Zone Overlay (AI classifications, Paint mode), Habitat Layer (species scoring), Depth Profile, and the AI Query panel.

Each tab shows only the panels relevant to that mode. Click the tab labels at the top of the sidebar to switch. The **Camera Position** and **Keyboard Cheat-Sheet** panels appear in all modes.

You can hide the whole column with the **◂ HIDE** button at the top to get an unobstructed view. Each section's collapsed or expanded state is remembered across reloads, so your preferred layout is restored automatically the next time you open the app.

## Overlays panel (Explore tab)

The **Overlays** panel in the Explore tab contains buttons that toggle environmental layers directly on the 3D scene:

| Button | What it does |
| --- | --- |
| 🗺 OVERVIEW | Opens/closes the top-down Overview Map (same as **O**) |
| 🔍 FIND DATA | Opens the dataset search and browse drawer |
| ◼ SUBSTRATE | Tints the seafloor by classified substrate type |
| 💨 WIND | Overlays surface wind-direction arrows — available any time the toggle is on |
| 🌊 TIDE | Overlays tidal-flow arrows — available any time the toggle is on |
| ↬ CURRENT | Overlays sub-surface current arrows — available any time the toggle is on |
| 🛩 NOAA WEATHER STATIONS | Toggles NOAA ASOS/AWOS station pins (saltwater only) |
| 🌿 RAWS WEATHER STATIONS | Toggles AOOS RAWS land station pins (saltwater only) |
| 📷 FAA WEATHERCAMS ↗ | Opens the FAA WeatherCams website in a new tab (saltwater only) |
| 🌊 INTERTIDAL HOTSPOTS | Toggles tidepool and beachcombing hotspot pins |
| 🐟 EFH | Overlays Essential Fish Habitat polygons (dataset-dependent) |

Wind, Tide, and Current overlays are available whenever their toggle is on — they are not conditional on specific tidal data being loaded.

## Floating panels

- **Marker form** — opens when you press **G** or use the terrain context menu → Drop GPS pin here.
- **Depth Profile** — appears along the bottom centre after you start a profile measurement.
- **Find Data** — slides in from the right when you click 🔍 FIND DATA.
- **Overview Map** — press **O** or click 🗺 OVERVIEW for a top-down minimap.

## Crosshair action menu (Q or right-click)

Pressing **Q** or right-clicking the terrain opens a context menu with actions at the current terrain point: Drop GPS pin, Measure, Depth Profile, Set home, Save bookmark, Copy coordinates, and Copy share link.

On touch devices, **tap-and-hold** the terrain (or any dataset/folder entry in the sidebar) to open the same context menu instead of right-clicking.

## Status badges

| Badge | Meaning |
| --- | --- |
| ◎ ORBIT | Camera is in orbit mode |
| ● FLY | Camera is in fly mode, mouse is locked |
| ◉ GPS | Camera is locked to your device's GPS position |
| OFFLINE | No internet connection — reads from local cache |
| PREDICTED | Tidal value is from harmonic forecast, not a live gauge |
| SIMULATED | Tidal arrow data is modelled, not from a real station |
| STALE | Weather observation is from cache, not a fresh fetch |
