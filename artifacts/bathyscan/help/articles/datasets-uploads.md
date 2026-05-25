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

**Limits:**

- Max file size: 50 MB
- Resolution: auto-binned to a 256×256 grid

After upload the app builds a terrain mesh, runs zone classification, and saves it under **Your saved datasets** so you can come back to it later.

![Upload drop-zone](/help/upload-dropzone.png)

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
