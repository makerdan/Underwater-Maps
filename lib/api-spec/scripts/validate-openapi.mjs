import { readFileSync } from "fs";
import yaml from "js-yaml";

/**
 * Parse an OpenAPI YAML document and turn js-yaml's parser metadata into an
 * actionable diagnostic for codegen callers.
 */
export function validateOpenApiFile(filePath) {
  const source = readFileSync(filePath, "utf8");

  try {
    yaml.load(source, { filename: filePath });
  } catch (error) {
    const line = error?.mark?.line;
    const column = error?.mark?.column;
    const location =
      Number.isInteger(line) && Number.isInteger(column)
        ? ` (line ${line + 1}, column ${column + 1})`
        : "";
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`OpenAPI YAML validation failed for ${filePath}: ${reason}${location}`);
  }
}