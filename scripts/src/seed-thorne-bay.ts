/**
 * seed-thorne-bay.ts — Pre-warms the Thorne Bay terrain cache.
 *
 * Fetches the terrain grid for the thorne-bay preset at 256×256 resolution
 * (the production default) by hitting the local API server. This populates
 * the disk cache so the first real user request is fast.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run seed-thorne-bay
 *
 * The script requires the API server to be running:
 *   pnpm --filter @workspace/api-server run dev
 *
 * Environment:
 *   API_URL — base URL of the API server (default: http://localhost:4000)
 */

const API_URL = process.env["API_URL"] ?? "http://localhost:4000";
const DATASET_ID = "thorne-bay";
const RESOLUTIONS = [64, 256];

interface TerrainData {
  datasetId: string;
  dataSource?: string;
  resolution: number;
  minDepth: number;
  maxDepth: number;
  synthetic?: boolean;
}

async function fetchTerrain(resolution: number): Promise<TerrainData> {
  const url = `${API_URL}/api/datasets/${DATASET_ID}/terrain?resolution=${resolution}`;
  console.log(`  GET ${url}`);

  const resp = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "(unreadable)");
    throw new Error(`HTTP ${resp.status}: ${body}`);
  }
  return (await resp.json()) as TerrainData;
}

async function fetchEfh(): Promise<{ features: unknown[] }> {
  const url = `${API_URL}/api/efh?datasetId=${DATASET_ID}`;
  console.log(`  GET ${url}`);
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as { features: unknown[] };
}

async function fetchSubstrate(): Promise<{ features: unknown[] }> {
  const url = `${API_URL}/api/substrate/${DATASET_ID}`;
  console.log(`  GET ${url}`);
  const resp = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as { features: unknown[] };
}

async function main(): Promise<void> {
  console.log(`\n=== BathyScan seed script: ${DATASET_ID} ===\n`);

  console.log("▶ Seeding terrain grids…");
  for (const res of RESOLUTIONS) {
    try {
      const grid = await fetchTerrain(res);
      const src = grid.dataSource ?? (grid.synthetic ? "synthetic" : "gebco");
      console.log(
        `  ✔ ${DATASET_ID} @ ${res}×${res}  source=${src}  ` +
          `depth=${grid.minDepth}–${grid.maxDepth} m`
      );
    } catch (err) {
      console.error(`  ✗ Failed to seed terrain @ ${res}×${res}: ${(err as Error).message}`);
    }
  }

  console.log("\n▶ Seeding EFH zones…");
  try {
    const efh = await fetchEfh();
    console.log(`  ✔ EFH: ${efh.features.length} species zone polygons`);
  } catch (err) {
    console.error(`  ✗ EFH seed failed: ${(err as Error).message}`);
  }

  console.log("\n▶ Seeding ShoreZone substrate polygons…");
  try {
    const sub = await fetchSubstrate();
    console.log(
      `  ✔ Substrate: ${sub.features.length} ShoreZone shore-unit polygons ` +
        `(source: alaska-shorezone)`,
    );
  } catch (err) {
    console.error(`  ✗ Substrate seed failed: ${(err as Error).message}`);
  }

  console.log("\n=== Seed complete ===\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
