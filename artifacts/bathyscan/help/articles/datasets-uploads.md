---
id: datasets-uploads
title: Datasets & Uploads
section: Features
order: 4
---

# Datasets & Uploads

The **Datasets** panel on the left lets you choose what terrain you are looking at.

## Built-in datasets

These are public regions sourced from agencies like GEBCO and NOAA. They are always available and load quickly. Click one to switch.

The list is filtered by the **Environment** toggle (Saltwater / Freshwater) at the top of the panel.

## Uploading your own bathymetry

Click **Upload** at the bottom of the Datasets panel and drop in a `.xyz` or `.csv` file.

**Format:** three columns — longitude, latitude, depth (in metres, positive down). Comma or whitespace separated. First-row header optional.

After upload the app builds a terrain mesh, runs zone classification, and saves it under **Your saved datasets** so you can come back to it later.

![Upload drop-zone](/help/upload-dropzone.png)

## Large files

Files larger than **10 MB** are uploaded using **chunked transfer** automatically — no extra steps required on your part.

What happens:

1. The file is split into 5 MB slices and each slice is sent to the server one at a time. A progress bar shows transfer progress (0–100%).
2. Once all slices arrive, the server assembles the file and starts processing it in the background (decompressing if needed, parsing coordinates, building the terrain grid). The progress bar switches to a **"Processing on server…"** spinner.
3. When processing is complete the dataset appears in **Your saved datasets** automatically. You can navigate away or leave the upload panel open — the result will show up either way.

You do not need to keep the upload panel open while the server processes.

**Limits:**

- Resolution: auto-binned to a 256×256 grid
- Processing: up to **200 MB** of uncompressed data. If your file is larger, gzip-compress it first — `.xyz.gz` files are typically 5–10× smaller and are handled automatically.

## My saved datasets

Once signed in, your uploads (and any catalog datasets you have saved) appear under **Your saved datasets**. Click one to load it, or click the × to delete.

## Find Data

The **🔍 Find Data** button in the bottom-right opens a slide-in panel where you can search a much larger catalog of public datasets. You can type a free-text query like:

> "Thorne Bay bathymetry"

or

> "Rockfish habitat off Oregon"

Hit **Save** on any result to add it to your saved list.

## Provenance

Every dataset has a small provenance box that tells you where the data came from, when it was collected, and at what resolution. Trust this when interpreting fine detail.
