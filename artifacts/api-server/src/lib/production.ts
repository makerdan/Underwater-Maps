/**
 * production.ts — zero-dependency production-mode detection.
 *
 * Extracted from env.ts into its own file so that logger.ts can import
 * isProduction() without creating a circular dependency
 * (logger.ts → env.ts → logger.ts).
 *
 * Do NOT add any project imports here. This file must remain import-free
 * to stay suitable as a universal helper across the api-server codebase.
 */

/**
 * Returns true when the server is running in a production context.
 *
 * Checks both `NODE_ENV=production` (the conventional Node.js production
 * flag) and `REPLIT_DEPLOYMENT` (set by Replit when a project is deployed).
 * Using both ensures that deployed Replit apps with a non-standard NODE_ENV
 * are still treated as production for security-relevant decisions.
 *
 * This is the single authoritative production-detection helper for the
 * api-server. Import it here — not from env.ts — when you cannot afford
 * a dependency on the env.ts logger.
 */
export function isProduction(): boolean {
  return (
    process.env["NODE_ENV"] === "production" ||
    Boolean(process.env["REPLIT_DEPLOYMENT"])
  );
}
