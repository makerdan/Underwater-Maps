import { seedDatasetCatalog } from "../../lib/catalogSeeder.js";

export async function seedCatalog(): Promise<void> {
  await seedDatasetCatalog();
}