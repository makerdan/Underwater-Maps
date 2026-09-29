import { createHash } from "node:crypto";

function normalize(value, ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON does not permit non-finite numbers");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") throw new TypeError("canonical JSON accepts only JSON values");
  if (ancestors.has(value)) throw new TypeError("canonical JSON does not permit circular values");
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError("canonical JSON accepts only plain objects and arrays");
  }

  ancestors.add(value);
  let normalized;
  if (Array.isArray(value)) {
    normalized = value.map((entry) => normalize(entry, ancestors));
  } else {
    normalized = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) {
        throw new TypeError(`canonical JSON does not permit accessor property '${key}'`);
      }
      normalized[key] = normalize(descriptor.value, ancestors);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError("canonical JSON does not permit symbol properties");
    }
  }
  ancestors.delete(value);
  return normalized;
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function digestJson(value) {
  return sha256(canonicalJson(value));
}