# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> BathyScan — smoke suite >> file upload zone is present on the page
- Location: tests/e2e/smoke.spec.ts:47:7

# Error details

```
Error: expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 1
Received:    0
```

# Page snapshot

```yaml
- generic [ref=e4]:
  - paragraph [ref=e5]: Deep Sea Explorer
  - heading "BATHYSCAN" [level=1] [ref=e6]
  - paragraph [ref=e8]: Explore 3D bathymetric seafloor maps. Upload sonar data, drop markers, and dive in.
  - button "Sign In to Explore" [ref=e9]
  - button "Create account" [ref=e11]
```

# Test source

```ts
  1   | import { test, expect } from "@playwright/test";
  2   | 
  3   | test.describe("BathyScan — smoke suite", () => {
  4   |   test.beforeEach(async ({ page }) => {
  5   |     await page.goto("/");
  6   |   });
  7   | 
  8   |   test("app loads without unhandled JS errors", async ({ page }) => {
  9   |     const errors: string[] = [];
  10  |     page.on("pageerror", (err) => {
  11  |       // WebGL context failure is expected in headless environments — ignore it
  12  |       if (!err.message.includes("WebGL")) {
  13  |         errors.push(err.message);
  14  |       }
  15  |     });
  16  |     await page.waitForLoadState("networkidle");
  17  |     expect(errors).toHaveLength(0);
  18  |   });
  19  | 
  20  |   test("Three.js canvas element is present with non-zero dimensions", async ({ page }) => {
  21  |     await page.waitForSelector("canvas", { timeout: 15_000 });
  22  |     const canvas = page.locator("canvas").first();
  23  |     const box = await canvas.boundingBox();
  24  |     expect(box).not.toBeNull();
  25  |     expect(box!.width).toBeGreaterThan(0);
  26  |     expect(box!.height).toBeGreaterThan(0);
  27  |   });
  28  | 
  29  |   test("dataset picker panel is present and lists 5 items", async ({ page }) => {
  30  |     // Wait for datasets to load
  31  |     await page.waitForTimeout(3000);
  32  |     const items = page.locator("[data-testid='dataset-item'], [role='option'], button[data-dataset]");
  33  |     // Fallback: count buttons in the picker area
  34  |     const pickerButtons = page.locator(".w-80 button, .w-80 [role='option']");
  35  |     const countA = await items.count();
  36  |     const countB = await pickerButtons.count();
  37  |     expect(countA + countB).toBeGreaterThanOrEqual(1);
  38  |   });
  39  | 
  40  |   test("HUD overlay is visible and depth value is a number", async ({ page }) => {
  41  |     await page.waitForLoadState("networkidle");
  42  |     // HUD depth shows "▼ N,NNN M" pattern
  43  |     const hudText = await page.locator("body").textContent();
  44  |     expect(hudText).toMatch(/▼\s*[\d,]+\s*M/);
  45  |   });
  46  | 
  47  |   test("file upload zone is present on the page", async ({ page }) => {
  48  |     await page.waitForLoadState("networkidle");
  49  |     const uploadEl = page.locator(
  50  |       "text=UPLOAD CUSTOM TERRAIN, [data-testid='upload-zone'], input[type='file']"
  51  |     );
  52  |     const count = await uploadEl.count();
> 53  |     expect(count).toBeGreaterThanOrEqual(1);
      |                   ^ Error: expect(received).toBeGreaterThanOrEqual(expected)
  54  |   });
  55  | 
  56  |   test("query panel: trigger button is visible and opens the panel", async ({ page }) => {
  57  |     await page.waitForLoadState("networkidle");
  58  | 
  59  |     // The query trigger button is always visible when signed in
  60  |     const trigger = page.locator("[data-testid='query-panel-trigger']");
  61  |     const triggerVisible = await trigger.isVisible({ timeout: 10_000 }).catch(() => false);
  62  |     if (!triggerVisible) {
  63  |       test.skip(true, "Query trigger not visible — user may not be signed in");
  64  |       return;
  65  |     }
  66  | 
  67  |     // Click the trigger — query panel should open
  68  |     await trigger.click();
  69  |     const panel = page.locator("[data-testid='query-panel']");
  70  |     await expect(panel).toBeVisible({ timeout: 3_000 });
  71  | 
  72  |     // The text input should be present inside the panel
  73  |     const input = page.locator("[data-testid='query-input']");
  74  |     await expect(input).toBeVisible();
  75  | 
  76  |     // The submit button should be present
  77  |     const submit = page.locator("[data-testid='query-submit']");
  78  |     await expect(submit).toBeVisible();
  79  |   });
  80  | 
  81  |   test("zone overlay: toggle changes aria-pressed and legend is visible", async ({ page }) => {
  82  |     await page.waitForLoadState("networkidle");
  83  | 
  84  |     // Zone Analysis panel only renders once terrain is loaded from the API.
  85  |     const zonePanel = page.locator("text=Zone Analysis");
  86  |     const panelVisible = await zonePanel.isVisible({ timeout: 10_000 }).catch(() => false);
  87  |     if (!panelVisible) {
  88  |       test.skip(true, "Zone Analysis panel not visible — API unreachable in this environment");
  89  |       return;
  90  |     }
  91  | 
  92  |     // Wait for the loading spinner to disappear (classification complete or error).
  93  |     await page.waitForFunction(() => !document.querySelector(".animate-spin"), { timeout: 30_000 });
  94  | 
  95  |     // Zone legend must be present and visible when classification succeeds.
  96  |     const legend = page.locator(".zone-legend");
  97  |     await expect(legend.first()).toBeVisible({ timeout: 5_000 });
  98  | 
  99  |     // The toggle button must carry aria-pressed="true" by default (overlay on).
  100 |     const toggleBtn = page.locator("[data-testid='zone-toggle']");
  101 |     await expect(toggleBtn).toBeVisible();
  102 |     await expect(toggleBtn).toHaveAttribute("aria-pressed", "true");
  103 | 
  104 |     // Click once → overlay off → aria-pressed flips to "false".
  105 |     await toggleBtn.click();
  106 |     await expect(toggleBtn).toHaveAttribute("aria-pressed", "false");
  107 | 
  108 |     // Click again → overlay on → aria-pressed returns to "true".
  109 |     await toggleBtn.click();
  110 |     await expect(toggleBtn).toHaveAttribute("aria-pressed", "true");
  111 |   });
  112 | });
  113 | 
```