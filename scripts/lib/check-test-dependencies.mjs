import { createRequire } from "node:module";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";

/**
 * pnpm links direct dependencies into each workspace package. A broken or
 * absent link can leave typecheck reporting TS2307 even when the lockfile is
 * correct; catch that before starting any validation step.
 */
export function checkTestDependencies(root) {
  const packages = [root, join(root, "scripts")];
  for (const scope of ["artifacts", "lib", "lib/integrations"]) {
    const scopeDir = join(root, scope);
    for (const entry of readdirSync(scopeDir, { withFileTypes: true })) {
      if (entry.isDirectory()) packages.push(join(scopeDir, entry.name));
    }
  }

  let checked = 0;
  for (const packageDir of packages) {
    const packageFile = join(packageDir, "package.json");
    if (!existsSync(packageFile)) continue;
    const pkg = JSON.parse(readFileSync(packageFile, "utf8"));
    if (!Object.hasOwn(pkg.devDependencies ?? {}, "vitest")) continue;
    checked++;
    try {
      const link = join(packageDir, "node_modules/vitest");
      lstatSync(link);
      realpathSync(link);
      createRequire(packageFile).resolve("vitest");
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "MODULE_NOT_FOUND") throw error;
      throw new Error(
        `${pkg.name}'s declared vitest dependency is not linked. ` +
        "Run `pnpm install --frozen-lockfile` at the workspace root before validation.",
        { cause: error },
      );
    }
  }
  if (checked === 0) throw new Error("No workspace packages declaring vitest were found");
}