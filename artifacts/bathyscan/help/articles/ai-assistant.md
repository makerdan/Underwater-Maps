---
id: ai-assistant
title: AI Assistant
section: Features
order: 9
---

# AI Assistant

The AI assistant is built into BathyScan as a smart helper that can drive the app, classify terrain, and answer questions about what you see.

## Opening the assistant

Press **`/`** anywhere in the main view to open the **Query** panel. Type a sentence and press Enter.

## What it can do

The assistant can both **answer questions** and **act on the app**. It can:

- Move the camera to a location ("take me to the deepest point").
- Filter the visible depth range.
- Highlight cells of a particular zone type.
- Change the colormap.
- Reset the view.
- Search the public dataset catalog.
- Describe a spot (depth, geology, likely habitat).

## Example prompts

Try these to get a feel for it:

> "Take me to the deepest point in this dataset."

> "Highlight all the coral reef potential zones."

> "What is this spot likely to be — sand, rock, or sediment?"

> "Switch to the thermal colormap."

> "Find me bathymetry data near Thorne Bay, Alaska."

> "Where are the best rockfish hotspots here?"

> "Filter to show only the 50–100 metre depth band."

## What to expect

For action prompts the assistant responds quickly and you see the camera or overlay change. For analytical prompts it returns 1–3 short sentences. It is intentionally concise.

## Habitat hotspots

The **Habitat Layer** panel (left side) is a related feature. Pick a species and it scores every cell of the terrain for that species' preferences, then lists the top hotspots. Click **Fly There** to teleport, or **Drop Pin** to save it as a marker.

## Limits

The assistant has a usage quota that resets every minute. If you hit the limit you will see a friendly message and need to wait briefly. The quota is shared across all AI features (classify, describe, query, help Q&A).

## Privacy

Your prompts and the context BathyScan sends (current dataset name, camera position, water type) are forwarded to the AI provider. They are not used to train models, but assume anything you type may be logged on the provider side.
