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

Good for getting the gist, not for survey-grade decisions. The model looks at depth shape and slope but cannot see substrate directly. Treat it as a strong hint and use **Paint mode** to correct anything you know better.

## Can I use BathyScan offline?

Yes, to an extent. Datasets you have already loaded are cached and stay available offline. Markers you drop while offline are queued and uploaded when you reconnect. You will see an **OFFLINE** badge in the top-right when this happens.

## Does it work on a phone?

It works, but a desktop with a mouse is the better experience. On touch devices you get a virtual joystick instead of WASD, and the Help window opens as a full-screen sheet.

## Are my markers and uploads private?

Yes. Markers and uploaded datasets are tied to your account and only visible to you.

## Why do I sometimes hit an AI rate limit?

Each user shares one quota across all AI features (classify, describe, query, help Q&A). It resets every minute. If you hit the limit, wait briefly and try again.

## Can I export my data?

CSV export of depth profiles and bulk export of markers are planned but not yet shipped. For now you can screenshot the depth profile chart.

## How do I change units to imperial?

Settings → HUD → Units.

## How do I report a bug or request a feature?

Use the email link at the bottom of any help article.
