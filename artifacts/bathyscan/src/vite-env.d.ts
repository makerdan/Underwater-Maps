/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vanillajs" />

/**
 * Project-specific Vite env vars. Merges with the ImportMetaEnv interface
 * from `vite/client` (already in tsconfig `types`), so
 * `import.meta.env.VITE_SITE_STATUS` is known to TypeScript.
 */
interface ImportMetaEnv {
  /**
   * Site-status gate: `"closed"` shows the closed-for-testing banner and
   * disables sign-ups (see `src/lib/siteStatus.ts`). Absent or any other
   * value = site open, no behaviour change.
   */
  readonly VITE_SITE_STATUS?: string;
}
