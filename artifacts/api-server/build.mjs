import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm, mkdir, copyFile, readdir, readFile } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const OPENAPI_PATH = path.resolve(artifactDir, "../../lib/api-spec/openapi.yaml");

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
// These routers are mounted under a public prefix, but their route
// registrations remain relative to their own router. Keep this list next to
// the bundle assertion so prefixed routes cannot silently pass by matching
// only an unmounted handler.
const MOUNTED_ROUTE_PREFIXES = ["/poe", "/github"];
export const DOCUMENTED_BUNDLE_ROUTE_EXCLUSIONS = Object.freeze({});

/**
 * Return every documented API route from the OpenAPI source of truth. This
 * intentionally uses the same fixed-indentation scan as the API
 * docs generator so the build does not need to load a YAML implementation.
 */
export function getDocumentedApiRoutes(yamlText) {
  const documented = [];
  let inPaths = false;
  let currentPath = null;

  for (const rawLine of yamlText.split("\n")) {
    const indent = rawLine.length - rawLine.trimStart().length;
    const content = rawLine.trim();

    if (!content || content.startsWith("#")) continue;

    if (indent === 0) {
      if (content === "paths:") {
        inPaths = true;
      } else if (inPaths) {
        inPaths = false;
      }
      continue;
    }

    if (!inPaths) continue;

    if (indent === 2) {
      const match = content.match(/^(\/[^:]+):/);
      currentPath = match?.[1] ?? null;
      continue;
    }

    if (indent === 4 && currentPath) {
      const method = content.replace(/:.*$/, "").toLowerCase();
      if (HTTP_METHODS.has(method)) {
        documented.push(`${method.toUpperCase()} ${currentPath}`);
      }
    }
  }

  return documented.sort();
}

/**
 * Preserve the narrower export used by the existing upload inventory test.
 * The production build uses getDocumentedApiRoutes so every documented route
 * is protected, while callers that specifically inspect upload routes retain
 * their old behavior.
 */
export function getDocumentedUploadRoutes(yamlText) {
  return getDocumentedApiRoutes(yamlText).filter((route) => {
    const path = route.slice(route.indexOf(" ") + 1);
    return path.startsWith("/datasets/upload") || path.startsWith("/datasets/raster-");
  });
}

export function openApiPathToExpressPath(openApiPath) {
  return openApiPath.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, ":$1");
}

function openApiPathToExpressPattern(openApiPath) {
  let pattern = "";
  let lastIndex = 0;
  const parameterPattern = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

  for (const match of openApiPath.matchAll(parameterPattern)) {
    const start = match.index ?? 0;
    pattern += escapeRegExp(openApiPath.slice(lastIndex, start));
    pattern += `(?::${match[1]}|\\*${match[1]})`;
    lastIndex = start + match[0].length;
  }

  pattern += escapeRegExp(openApiPath.slice(lastIndex));
  return pattern;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function routeRegistrationExists(bundleText, method, openApiPath, mountPrefix = "") {
  const routePath = mountPrefix
    ? openApiPath.slice(mountPrefix.length)
    : openApiPath;
  const pattern = new RegExp(
    `\\.${method}\\s*\\(\\s*["'\`]${openApiPathToExpressPattern(routePath)}["'\`]`,
  );
  return pattern.test(bundleText);
}

/**
 * Ensure the route registrations survived esbuild into the production entry
 * bundle. Matching the method call and literal path together avoids a path-only
 * check passing when a route's HTTP verb was accidentally changed or removed.
 */
export function assertApiRoutesInProductionBundle(bundleText, routes) {
  const missing = routes.filter((route) => {
    const separator = route.indexOf(" ");
    const method = route.slice(0, separator).toLowerCase();
    const openApiPath = route.slice(separator + 1);
    if (routeRegistrationExists(bundleText, method, openApiPath)) {
      return false;
    }

    return !MOUNTED_ROUTE_PREFIXES.some((prefix) => {
      if (!openApiPath.startsWith(`${prefix}/`)) return false;
      const mountPattern = new RegExp(
        `\\.use\\s*\\(\\s*["'\`]${escapeRegExp(prefix)}["'\`]`,
      );
      return mountPattern.test(bundleText) &&
        routeRegistrationExists(bundleText, method, openApiPath, prefix);
    });
  });

  if (missing.length > 0) {
    throw new Error(
      "[api-bundle-smoke] Production API bundle is missing documented " +
        `route registration(s): ${missing.join(", ")}. ` +
        "Check route composition and the esbuild entrypoint before release.",
    );
  }
}

export function assertUploadRoutesInProductionBundle(bundleText, routes) {
  const missing = routes.filter((route) => {
    const separator = route.indexOf(" ");
    const method = route.slice(0, separator).toLowerCase();
    const openApiPath = route.slice(separator + 1);
    return !routeRegistrationExists(bundleText, method, openApiPath);
  });

  if (missing.length > 0) {
    throw new Error(
      "[api-bundle-smoke] Production API bundle is missing documented " +
        `upload route registration(s): ${missing.join(", ")}. ` +
        "Check route composition and the esbuild entrypoint before release.",
    );
  }
}

export async function buildAll() {
  // Allow callers to redirect the output directory so parallel build invocations
  // (e.g. the regular dev workflow vs the E2E webServer) don't race on the same
  // `dist/` folder.
  //   • tests/e2e/global-setup.ts sets DIST_DIR=dist-e2e before Playwright
  //     starts the webServer, guaranteeing dist-e2e/index.mjs exists.
  //   • The `build:e2e` and `dev:e2e` scripts also set DIST_DIR=dist-e2e.
  //   • The regular `build` / `dev` scripts leave DIST_DIR unset → dist/.
  const distDir = path.resolve(artifactDir, process.env["DIST_DIR"] ?? "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [
      path.resolve(artifactDir, "src/index.ts"),
      path.resolve(artifactDir, "src/lib/parseWorker.ts"),
    ],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Generated substrate JSON bundles are loaded at runtime via
    // fs.readFileSync (see src/lib/shoreZoneData.ts). They live in
    // src/lib/ and must be copied to dist/ so the bundled server can find
    // them.
    // (Asset copy happens after esbuild completes; see below.)
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  const documentedApiRoutes = getDocumentedApiRoutes(
    await readFile(OPENAPI_PATH, "utf8"),
  );
  const protectedApiRoutes = documentedApiRoutes.filter(
    (route) => !Object.hasOwn(DOCUMENTED_BUNDLE_ROUTE_EXCLUSIONS, route),
  );
  assertApiRoutesInProductionBundle(
    await readFile(path.join(distDir, "index.mjs"), "utf8"),
    protectedApiRoutes,
  );
  console.log(
    `[api-bundle-smoke] verified ${protectedApiRoutes.length} documented API routes` +
      ` (${documentedApiRoutes.length - protectedApiRoutes.length} explicitly excluded)`,
  );

  // Copy runtime JSON assets next to the bundled entrypoint so
  // `fs.readFileSync(resolve(__dirname, '...gen.json'))` works in the
  // production build. __dirname in dist/index.mjs resolves to `distDir/`,
  // so the files must live there.
  const libDir = path.resolve(artifactDir, "src/lib");
  const libFiles = await readdir(libDir);
  await mkdir(distDir, { recursive: true });
  for (const name of libFiles) {
    if (name.endsWith(".gen.json") || name.endsWith(".py")) {
      await copyFile(path.join(libDir, name), path.join(distDir, name));
      console.log(`  copied runtime asset: ${name}`);
    }
  }

  // laz-perf's Emscripten loader resolves its .wasm file relative to the
  // bundled entrypoint (dist/index.mjs) at runtime; without this copy every
  // .laz upload fails with "ENOENT ... dist/laz-perf.wasm".
  const lazPerfWasm = require.resolve("laz-perf/lib/node/laz-perf.wasm", {
    paths: [artifactDir],
  });
  await copyFile(lazPerfWasm, path.join(distDir, "laz-perf.wasm"));
  console.log("  copied runtime asset: laz-perf.wasm");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  buildAll().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
