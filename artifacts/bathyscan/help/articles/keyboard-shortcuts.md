---
id: keyboard-shortcuts
title: Keyboard Shortcuts
section: Reference
order: 12
---

# Keyboard Shortcuts

Every key BathyScan responds to, in one place.

## Camera

| Key | Action |
| --- | --- |
| Click scene | Lock the mouse and enter Fly mode |
| Esc | Release the mouse / close open panels |
| Tab | Toggle between Orbit and Fly mode |
| W | Move forward (fly mode) |
| S | Move backward (fly mode) |
| A | Strafe left (fly mode) |
| D | Strafe right (fly mode) |
| Space | Ascend (fly mode) |
| Shift | Descend (fly mode) |
| = | Speed tier up |
| - | Speed tier down |
| Scroll wheel | Change speed tier (fly mode) / Zoom (orbit mode) |
| Right-drag | Orbit around the terrain point under the cursor |
| Ctrl + drag | Orbit around the terrain point under the cursor |

## Markers and tools

| Key | Action |
| --- | --- |
| G | Drop a GPS pin at the crosshair location (fly mode) |
| Right-click | Open the terrain context menu at the crosshair |
| Q | Open the **Crosshair Action Menu** at the crosshair (same as right-click) |

### Crosshair Action Menu (Q or right-click)

The crosshair menu contains actions that operate on the current terrain point:

- **Drop GPS pin here** — opens the marker creation form.
- **Measure from here / to here** — starts or ends a distance measurement.
- **Start straight-line profile / Start path profile** — begins a depth profile.
- **Add waypoint here / Finish path here** — builds a multi-waypoint path profile.
- **Set as home position** — saves this location as the default spawn for this dataset.
- **Save view as bookmark…** — saves the current camera position and heading by name.
- **Copy coordinates** — copies `lat, lon, depth` to the clipboard.
- **Copy share link** — copies the current URL (with camera parameters) to the clipboard.

## Panels

| Key | Action |
| --- | --- |
| O | Toggle the **Overview Map** open/closed |
| / | Open the **AI Query** panel |
| , (comma) | Open **Settings** |
| ? | Open the **Keyboard Shortcuts** reference modal |
| Esc | Close the query panel / clear highlights / release fly-mode mouse |

## Gamepad / controller

BathyScan responds to gamepads connected via the browser's Gamepad API.

| Input | Action |
| --- | --- |
| **Y button** (Xbox) / **Triangle** (PlayStation) | Open the Crosshair Action Menu (same as Q) |

Movement via gamepad sticks and triggers is not currently supported; use a keyboard and mouse for full fly-mode control.

## Tips

- **Esc** is context-sensitive: it closes the topmost open panel first, then releases the mouse if fly mode is active.
- The `=` and `-` keys adjust speed tier from anywhere in fly mode, even without scroll-wheel access.
- **Right-drag** (or **Ctrl + drag**) lets you orbit around a specific terrain point without entering orbit mode.
- On laptops, use a two-finger trackpad swipe to zoom in orbit mode.
