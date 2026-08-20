import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";

// Canvas is served by the managed artifact on this port. Vite evaluates this
// config during builds too, so use the artifact value when no preview server
// environment has been injected.
const DEFAULT_PORT = 8081;
const rawPort = process.env.PORT ?? String(DEFAULT_PORT);

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Keep the default aligned with the artifact's registered previewPath while
// allowing managed or local callers to override it.
const basePath = process.env.BASE_PATH ?? "/__mockup";

export default defineConfig({
  base: basePath,
  plugins: [
    mockupPreviewPlugin() as unknown as PluginOption,
    react() as unknown as PluginOption,
    tailwindcss() as unknown as PluginOption,
    runtimeErrorOverlay() as unknown as PluginOption,
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }) as unknown as PluginOption,
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
