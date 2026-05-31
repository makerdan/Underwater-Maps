---
id: glossary
title: Glossary
section: Reference
order: 15
---

# Glossary

Quick definitions for terms you will see throughout BathyScan.

**Crosshair Action Menu** — a context menu opened with **Q** or right-click that lists actions at the current terrain point: Drop GPS pin, Measure, Depth Profile, Set home, Save bookmark, Copy coordinates, and Copy share link.

**Argo float** — an autonomous oceanographic profiling buoy that measures temperature and salinity at depth. BathyScan uses Argo data in the **Temperature Profile Chart** (opened via the TEMP chip in the HUD), which is separate from the depth profile panel.

**Bathymetry** — the measurement of underwater depth. A bathymetric chart is the underwater equivalent of a topographic map.

**Breadcrumb trail** — the recorded GPS track drawn on the terrain and overview map while the GPS Trail Recorder is active. See [GPS & Trail Recorder](#article:gps-trail-recorder).

**Caustics** — the shimmering light-refraction patterns that appear on the seafloor in shallow water. A visual effect toggle in Settings → Visuals.

**Colormap** — the colour gradient used to shade the terrain by depth. Options include Ocean, Freshwater, Thermal, Grayscale, Viridis, Magma, Colour-blind (CVD), and Custom.

**Contour lines** — iso-depth lines drawn on the terrain at regular depth intervals. The interval auto-scales with zoom level and can be adjusted under Settings → Visuals → Contour Interval.

**Crosshair / reticle** — the small cross in the centre of the screen. It marks the point on the terrain you are pointing at.

**CTD cast** — a Conductivity-Temperature-Depth instrument lowered from a research vessel to measure water properties at depth. BathyScan uses CTD data alongside Argo data for temperature overlays.

**Dataset** — one packaged region of bathymetric data. Built-in datasets are public; saved datasets are yours.

**Depth profile** — a vertical cross-section between two points on the terrain. See [Depth Profile](#article:depth-profile).

**Drift** — the motion of a boat or fishing line caused by wind and current when the engine is off. Modelled in the [Drift Planner](#article:drift-planner).

**Essential Fish Habitat (EFH)** — regulated zones in some US waters where particular fish species are known to feed or spawn. Shown with the 🐟 EFH HUD button when the active dataset includes EFH data.

**Flight category** — an aviation weather classification based on ceiling and visibility (VFR, MVFR, IFR, LIFR). BathyScan displays the raw ceiling and visibility values from each station's observation; the station popover lets you assess conditions directly from those values.

**Fly mode** — first-person free-flight camera. Locks the mouse and uses WASD + Space/Shift.

**Follow Me** — GPS-lock mode that tracks your real-world location and moves the 3D camera to match. See [GPS & Trail Recorder](#article:gps-trail-recorder).

**GPX** — a standard XML file format for GPS data (waypoints, routes, tracks). BathyScan can import and export GPX files. Compatible with Garmin, Navionics, and most chart plotters.

**Heading (HDG)** — the compass direction the camera is pointing, 0°–360°.

**Hotspot** — a cell scored highly for a particular species' habitat preferences.

**KML** — Keyhole Markup Language, a file format used by Google Earth and Google Maps. BathyScan can import and export KML files.

**Landmass layer** — the above-water terrain rendered around the edges of the dataset for geographic context.

**Marine snow** — slow-falling organic particles in the water column. A visual effect toggle in Settings → Visuals.

**Marker** — a persistent pin you drop on the seafloor. See [Markers](#article:markers).

**METAR** — Meteorological Aerodrome Report. A coded aviation weather observation issued by a reporting station, typically every hour. BathyScan shows key decoded fields (wind, visibility, ceiling, temperature) in the station popover when you click a weather station pin.

**Orbit mode** — third-person camera that swings around a target. The default mode at load time.

**Overview map** — a top-down minimap (press **O**) showing the full dataset, camera position, markers, tidal arrows, and GPS trail. See [Overview Map](#article:overview-map).

**Paint mode** — a tool for manually correcting the AI's zone classification. See [Zones & Paint Mode](#article:zones-paint-mode).

**Provenance** — metadata about where a dataset came from, when, and at what resolution.

**Satellite imagery** — aerial or satellite photos draped over the landmass layer for a photo-realistic look. Independent toggle for the 3D scene and the overview map.

**Simulated badge** — shown on tidal arrow overlays when the arrow data is modelled from harmonic data rather than sourced from a real-time current station.

**Slack tide** — the short period around a high or low tide when the tidal current is near zero and reverses direction.

**Substrate** — what the seafloor is made of: sand, sediment, silt, basalt, etc.

**Thermocline** — the layer of water where temperature drops sharply with depth. Shown as a shaded band in the **Temperature Profile Chart** (opened via the TEMP chip in the HUD), not in the depth profile panel.

**Tidal overlay** — animated arrows showing tide-driven currents at a chosen depth layer.

**Transect** — a planned line across the terrain, typically followed by a boat with a sounder.

**Trolling mode** — Drift Planner mode that simulates powered movement at a set speed and heading. See [Drift Planner](#article:drift-planner).

**Water type** — saltwater or freshwater. Determines available datasets, marker types, zone labels, and AI vocabulary.

**Waypoint** — a sequential target in the Drift Planner's route. Multiple waypoints form a route with per-leg distance and time estimates. See [Drift Planner](#article:drift-planner).

**WeatherCam** — an FAA live camera feed at a coastal, mountain, or airport location. BathyScan links to the FAA WeatherCams website (via the **📷 FAA WEATHERCAMS ↗** button in the Overlays panel) so you can view camera feeds in a new browser tab.

**Zone** — an AI-assigned label for a region of terrain (e.g. *sandy_shelf*, *aquatic_vegetation*). See [Zones & Paint Mode](#article:zones-paint-mode).
