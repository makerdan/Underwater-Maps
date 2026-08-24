import { readFileSync } from "fs";
import yaml from "js-yaml";

/**
 * Parse an OpenAPI YAML document and turn js-yaml's parser metadata into an
 * actionable diagnostic for codegen callers.
 */
export function validateOpenApiFile(filePath) {
  const source = readFileSync(filePath, "utf8");
  let document;

  try {
    document = yaml.load(source, { filename: filePath });
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

  validateOpenApiDocument(document, filePath);
  return document;
}

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
const SCHEMA_TYPES = new Set(["array", "boolean", "integer", "number", "object", "string", "null"]);
const STATUS_KEY = /^(default|[1-5][0-9]{2}|[1-5]XX)$/;

function fail(filePath, location, message) {
  throw new Error(`OpenAPI semantic validation failed for ${filePath}: ${location} ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pointerValue(value) {
  return value.replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolveLocalReference(document, ref, filePath, location) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) {
    fail(filePath, location, `"$ref" must be a local JSON pointer, got ${JSON.stringify(ref)}`);
  }
  let value = document;
  for (const part of ref.slice(2).split("/").map(pointerValue)) {
    if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, part)) {
      fail(filePath, location, `"$ref" points to missing component ${JSON.stringify(ref)}`);
    }
    value = value[part];
  }
  return value;
}

function validateSchema(schema, document, filePath, location, seen = new Set()) {
  if (!isRecord(schema)) fail(filePath, location, "schema must be an object");
  if (typeof schema.$ref === "string") {
    const target = resolveLocalReference(document, schema.$ref, filePath, location);
    if (target === schema || seen.has(target)) return;
    validateSchema(target, document, filePath, `${location} (${schema.$ref})`, new Set([...seen, schema]));
  }
  if (schema.type !== undefined && (typeof schema.type !== "string" || !SCHEMA_TYPES.has(schema.type))) {
    fail(filePath, `${location}.type`, `must be one of ${[...SCHEMA_TYPES].join(", ")}`);
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    fail(filePath, `${location}.enum`, "must be a non-empty array");
  }
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((x) => typeof x !== "string"))) {
    fail(filePath, `${location}.required`, "must be an array of property names");
  }
  if (schema.properties !== undefined && !isRecord(schema.properties)) {
    fail(filePath, `${location}.properties`, "must be an object");
  }
  if (schema.type === "object" && schema.items !== undefined) {
    fail(filePath, `${location}.items`, "is incompatible with type \"object\"; only arrays may define items");
  }
  if (schema.type === "array" && schema.items === undefined) {
    fail(filePath, `${location}.items`, "is required for an array schema");
  }
  if (schema.items !== undefined) {
    validateSchema(schema.items, document, filePath, `${location}.items`, seen);
  }
  for (const key of ["properties", "patternProperties", "$defs", "definitions"]) {
    if (isRecord(schema[key])) {
      for (const [name, child] of Object.entries(schema[key])) {
        validateSchema(child, document, filePath, `${location}.${key}.${name}`, seen);
      }
    }
  }
  for (const key of ["oneOf", "anyOf", "allOf", "prefixItems"]) {
    if (schema[key] !== undefined && (!Array.isArray(schema[key]) || schema[key].length === 0)) {
      fail(filePath, `${location}.${key}`, "must be a non-empty array of schemas");
    }
    for (const [index, child] of (schema[key] ?? []).entries()) {
      validateSchema(child, document, filePath, `${location}.${key}[${index}]`, seen);
    }
  }
}

function validateParameter(parameter, document, filePath, location) {
  if (!isRecord(parameter)) fail(filePath, location, "parameter must be an object");
  if (typeof parameter.$ref === "string") {
    resolveLocalReference(document, parameter.$ref, filePath, location);
    return;
  }
  if (!["path", "query", "header", "cookie"].includes(parameter.in) || typeof parameter.name !== "string") {
    fail(filePath, location, "parameter requires a valid \"in\" and string \"name\"");
  }
  if (parameter.in === "path" && parameter.required !== true) {
    fail(filePath, `${location}.required`, "path parameters must set required: true");
  }
  if (parameter.schema !== undefined) validateSchema(parameter.schema, document, filePath, `${location}.schema`);
}

function validateOperation(operation, document, filePath, location) {
  if (!isRecord(operation)) fail(filePath, location, "operation must be an object");
  if (operation.operationId !== undefined && typeof operation.operationId !== "string") {
    fail(filePath, `${location}.operationId`, "must be a string");
  }
  if (!isRecord(operation.responses) || Object.keys(operation.responses).length === 0) {
    fail(filePath, `${location}.responses`, "is required and must contain at least one response");
  }
  for (const [status, response] of Object.entries(operation.responses ?? {})) {
    const responseLocation = `${location}.responses.${status}`;
    if (!STATUS_KEY.test(status)) fail(filePath, responseLocation, "must be a valid HTTP status code or default");
    if (!isRecord(response)) fail(filePath, responseLocation, "response must be an object");
    if (typeof response.$ref === "string") {
      resolveLocalReference(document, response.$ref, filePath, responseLocation);
    } else if (typeof response.description !== "string") {
      fail(filePath, `${responseLocation}.description`, "is required for an inline response");
    }
    if (response.content !== undefined && !isRecord(response.content)) {
      fail(filePath, `${responseLocation}.content`, "must be an object of media types");
    }
    for (const [contentType, media] of Object.entries(response.content ?? {})) {
      if (!isRecord(media)) fail(filePath, `${responseLocation}.content.${contentType}`, "media type must be an object");
      if (media.schema !== undefined) validateSchema(media.schema, document, filePath, `${responseLocation}.content.${contentType}.schema`);
    }
  }
  if (operation.parameters !== undefined && !Array.isArray(operation.parameters)) {
    fail(filePath, `${location}.parameters`, "must be an array");
  }
  for (const [index, parameter] of (operation.parameters ?? []).entries()) {
    validateParameter(parameter, document, filePath, `${location}.parameters[${index}]`);
  }
  if (operation.requestBody?.$ref) {
    resolveLocalReference(document, operation.requestBody.$ref, filePath, `${location}.requestBody`);
  } else if (operation.requestBody?.content) {
    if (!isRecord(operation.requestBody.content)) {
      fail(filePath, `${location}.requestBody.content`, "must be an object of media types");
    }
    for (const [contentType, media] of Object.entries(operation.requestBody.content)) {
      if (!isRecord(media)) fail(filePath, `${location}.requestBody.content.${contentType}`, "media type must be an object");
      if (media.schema !== undefined) validateSchema(media.schema, document, filePath, `${location}.requestBody.content.${contentType}.schema`);
    }
  }
}

/** Validate parsed OpenAPI structure before any generator consumes it. */
export function validateOpenApiDocument(document, filePath = "<document>") {
  if (!isRecord(document)) fail(filePath, "$", "document must be an object");
  if (typeof document.openapi !== "string" || !/^3\.[01]\.\d+$/.test(document.openapi)) {
    fail(filePath, "$.openapi", "must be an OpenAPI 3.0.x or 3.1.x version string");
  }
  if (!isRecord(document.info) || typeof document.info.title !== "string" || typeof document.info.version !== "string") {
    fail(filePath, "$.info", "must contain string title and version fields");
  }
  if (!isRecord(document.paths)) fail(filePath, "$.paths", "is required and must be an object");
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    const location = `$.paths[${JSON.stringify(path)}]`;
    if (!path.startsWith("/")) fail(filePath, location, "path keys must begin with \"/\"");
    if (!isRecord(pathItem)) fail(filePath, location, "path item must be an object");
    for (const [method, operation] of Object.entries(pathItem)) {
      if (HTTP_METHODS.has(method)) validateOperation(operation, document, filePath, `${location}.${method}`);
      else if (!["summary", "description", "parameters", "servers", "$ref"].includes(method)) {
        fail(filePath, `${location}.${method}`, "is not a valid path-item field");
      }
    }
    if (pathItem.parameters !== undefined && !Array.isArray(pathItem.parameters)) {
      fail(filePath, `${location}.parameters`, "must be an array");
    }
    for (const [index, parameter] of (pathItem.parameters ?? []).entries()) {
      validateParameter(parameter, document, filePath, `${location}.parameters[${index}]`);
    }
  }
  if (document.components !== undefined && !isRecord(document.components)) {
    fail(filePath, "$.components", "must be an object");
  }
  for (const collection of ["schemas", "responses", "parameters", "requestBodies", "headers", "securitySchemes"]) {
    if (document.components?.[collection] !== undefined && !isRecord(document.components[collection])) {
      fail(filePath, `$.components.${collection}`, "must be an object");
    }
  }
  for (const [name, schema] of Object.entries(document.components?.schemas ?? {})) {
    validateSchema(schema, document, filePath, `$.components.schemas.${name}`);
  }
  // Check every reference, including refs in less common component types.
  const walk = (value, location, seen = new Set()) => {
    if (!isRecord(value) && !Array.isArray(value)) return;
    if (seen.has(value)) return;
    seen.add(value);
    if (isRecord(value) && typeof value.$ref === "string") resolveLocalReference(document, value.$ref, filePath, `${location}.$ref`);
    for (const [key, child] of Object.entries(value)) walk(child, `${location}.${key}`, seen);
  };
  walk(document, "$");
  return document;
}