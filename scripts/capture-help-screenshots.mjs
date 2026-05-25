#!/usr/bin/env node
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(
  REPO_ROOT,
  "artifacts/bathyscan/public/help",
);

const BASE_URL = process.env.CAPTURE_BASE_URL ?? "http://localhost:3150";
const VIEWPORT = { width: 1440, height: 900 };
const HEADLESS = process.env.CAPTURE_HEADLESS !== "0";

async function ensureCanvasReady(page) {
  const canvas = page.locator("canvas").first();
  await canvas.waitFor({ state: "visible", timeout: 30_000 });
  const ok = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return false;
    const gl =
      c.getContext("webgl2") ||
      c.getContext("webgl") ||
      c.getContext("experimental-webgl");
    return !!gl;
  });
  if (!ok) {
    throw new Error(
      "Canvas is present but WebGL context could not be created. " +
        "Run this script on a machine with a real GPU (or pass " +
        "CAPTURE_HEADLESS=0 to use a windowed browser).",
    );
  }
  // Give the scene a beat to finish first paint of terrain + HUD.
  await page.waitForTimeout(2500);
}

async function shot(page, name) {
  const path = resolve(OUT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`  ✓ wrote ${path}`);
}

async function captureFullScreen(page) {
  console.log("• full-screen.png — main 3D view with HUD overlays");
  await page.goto(BASE_URL + "/", { waitUntil: "networkidle" });
  await ensureCanvasReady(page);
  // Move pointer into the scene so the reticle updates with real coords.
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(500);
  await shot(page, "full-screen");
}

async function captureDatasetsPanel(page) {
  console.log("• datasets-panel.png — left dataset panel");
  await page.goto(BASE_URL + "/", { waitUntil: "networkidle" });
  await ensureCanvasReady(page);
  const firstDataset = page
    .locator("[data-testid^='btn-dataset-']")
    .first();
  await firstDataset.waitFor({ state: "visible", timeout: 15_000 });
  await shot(page, "datasets-panel");
}

async function captureUploadDropzone(page) {
  console.log("• upload-dropzone.png — upload area on the dataset panel");
  await page.goto(BASE_URL + "/", { waitUntil: "networkidle" });
  await ensureCanvasReady(page);
  const dropzone = page.locator("[data-testid='dropzone-terrain']");
  await dropzone.waitFor({ state: "visible", timeout: 15_000 });
  await dropzone.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot(page, "upload-dropzone");
}

async function captureDepthProfile(page) {
  console.log(
    "• depth-profile.png — depth-profile panel after measuring a line",
  );
  await page.goto(BASE_URL + "/", { waitUntil: "networkidle" });
  await ensureCanvasReady(page);

  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Could not measure canvas bounding box");

  // Right-click a point near the centre, choose "Measure from here",
  // then left-click a second point to complete the profile.
  const p1 = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.55 };
  const p2 = { x: box.x + box.width * 0.65, y: box.y + box.height * 0.45 };
  await page.mouse.move(p1.x, p1.y);
  await page.mouse.click(p1.x, p1.y, { button: "right" });

  const measureItem = page
    .getByRole("menuitem", { name: /measure from here/i })
    .first();
  await measureItem.waitFor({ state: "visible", timeout: 5_000 });
  await measureItem.click();

  await page.mouse.move(p2.x, p2.y, { steps: 20 });
  await page.mouse.click(p2.x, p2.y);

  const panel = page.locator("[data-testid='depth-profile-panel']");
  await panel.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(800);
  await shot(page, "depth-profile");
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(
    `Capturing help screenshots from ${BASE_URL} → ${OUT_DIR}\n` +
      `(headless=${HEADLESS}). Ensure the dev servers are running with\n` +
      `VITE_DEV_AUTH_BYPASS=1 (web) and E2E_AUTH_BYPASS=1 (api).\n`,
  );

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  try {
    await captureFullScreen(page);
    await captureDatasetsPanel(page);
    await captureUploadDropzone(page);
    await captureDepthProfile(page);
  } finally {
    await context.close();
    await browser.close();
  }
  console.log("\nDone. Review the PNGs and commit if they look right.");
}

main().catch((err) => {
  console.error("\nCapture failed:", err.message);
  process.exitCode = 1;
});
