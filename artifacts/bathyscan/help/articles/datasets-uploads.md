---
id: datasets-uploads
title: Datasets & Uploads
section: Features
order: 4
---

# Datasets & Uploads

The **Datasets** panel on the left lets you choose what terrain you are looking at, upload your own bathymetric data, and organise your saved datasets and markers into folders.

## Built-in datasets

These are public regions sourced from agencies like GEBCO and NOAA. They are always available and load quickly. Click one to switch.

The list is filtered by the **Environment** toggle (Saltwater / Freshwater) at the top of the panel.

## Uploading your own bathymetry

Click **Upload** at the bottom of the Datasets panel and drop in a `.xyz` or `.csv` file.

**Format:** three columns — longitude, latitude, depth (in metres, positive down). Comma or whitespace separated. First-row header optional.

After upload the app builds a terrain mesh, runs zone classification, and saves it. Your new dataset appears automatically under **My Uploads** — no manual save step is required. Click it to load it immediately.

![Upload drop-zone](/help/upload-dropzone.png)

## Large files

Files larger than **10 MB** are uploaded using **chunked transfer** automatically — no extra steps required.

What happens:

1. The file is split into 5 MB slices and each slice is sent one at a time. A progress bar shows transfer progress (0–100 %).
2. Once all slices arrive, the server assembles the file and processes it in the background (decompressing if needed, parsing coordinates, building the terrain grid). The progress bar switches to a **"Processing on server…"** spinner.
3. When processing is complete the dataset appears in **Your saved datasets** automatically.

You do not need to keep the upload panel open while the server processes.

**Limits:**

- Resolution: auto-binned to a 256×256 grid.
- Processing: up to **200 MB** of uncompressed data. If your file is larger, gzip-compress it first — `.xyz.gz` files are typically 5–10× smaller and are handled automatically.

## Dataset folders

Your saved datasets can be organised into **folders**. Click **+ New Folder** inside the Datasets panel, type a name, and press Enter. Drag a dataset onto a folder to move it in. Folders help when you have many uploads covering different areas or projects.

### Context menu actions on folders and datasets

Right-click (or **tap-and-hold** on touch) any folder or dataset entry to open its context menu:

| Action | What it does |
| --- | --- |
| **Rename** | Edit the name of the folder or dataset inline |
| **Duplicate** | Creates a copy of the dataset under a new name (same grid data, independent markers) |
| **Move to folder** | Opens a folder picker so you can relocate the item without drag-and-drop |
| **Delete** | Permanently removes the dataset or folder. Deleting a folder also deletes all datasets inside it and their markers — a confirmation dialog warns you before proceeding |

## Very large files

Files above **50 MB** are routed to cloud storage automatically — the file goes directly from your browser to a secure cloud bucket, bypassing the server entirely.

What happens:

1. BathyScan requests a secure upload link, then transfers your file straight to cloud storage while showing a real upload progress bar.
2. Once the transfer finishes, the app shows **"Processing in background — we'll notify you when it's ready."** You can leave the panel open or navigate away.
3. The server processes the file in the background (decompressing, parsing, building the terrain grid). This typically takes a few minutes depending on file size.
4. When processing is complete the dataset appears in **Your saved datasets** automatically. The panel will load it for you.

No extra steps are needed — the routing between regular, chunked, and cloud-storage upload paths happens automatically based on file size.

## My saved datasets

Once signed in, your uploads (and any catalog datasets you have saved) appear under **Your saved datasets**. Click one to load it, or click **×** to delete it. Deleting a dataset also deletes its markers.

## Find Data

The **🔍 FIND DATA** button in the Overlays panel (left sidebar) opens a slide-in panel where you can search a larger catalog of public datasets by free-text query:

> "Thorne Bay bathymetry"

> "Rockfish habitat off Oregon"

Click **Save** on any result to add it to your saved list.

See [Find Data](#article:find-data) for full details on the Search tab, the My Saves tab, and status pills.

## GPX / KML import and export

You can move waypoints between BathyScan and external chart plotters and apps:

- **Export** — open the Markers section inside Datasets, click **Export**, and choose **GPX** or **KML**. You can export all markers or just the contents of one folder.
- **Import** — click **Import → GPX / KML** and drop in a file. Each waypoint becomes a **Custom** marker, preserving the name from the file.

See [Markers](#article:markers) for full details on folders, drag-to-folder, and the delete-confirmation flow.

## Provenance

Every dataset has a small provenance box that tells you where the data came from, when it was collected, and at what resolution. Check this when interpreting fine detail — resolution varies from sub-metre survey data to ~500 m GEBCO open-ocean grids. See [Data Provenance](#article:data-provenance) for a full breakdown of each source badge.
