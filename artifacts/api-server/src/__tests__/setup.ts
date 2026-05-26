import { beforeEach } from "vitest";
import { clearAllCaches } from "../lib/cacheRegistry.js";

beforeEach(() => {
  clearAllCaches();
});
