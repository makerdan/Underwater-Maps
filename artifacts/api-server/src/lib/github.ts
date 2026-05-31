import { Octokit } from "@octokit/rest";

/**
 * getGithubClient — constructs a fresh Octokit instance backed by the
 * GITHUB_TOKEN Personal Access Token stored in environment variables.
 *
 * A new instance is created on every call (no module-level singleton) so
 * that token rotation or env changes take effect without a server restart —
 * mirroring the pattern used by other lib wrappers in this codebase.
 *
 * Throws a descriptive error if GITHUB_TOKEN is absent so the caller can
 * immediately return a clear 500 rather than receiving a cryptic auth failure
 * from the GitHub API.
 */
export function getGithubClient(): Octokit {
  const token = process.env["GITHUB_TOKEN"];
  if (!token) {
    throw new Error(
      "[github] GITHUB_TOKEN environment variable is not set. " +
        "Add it to Replit Secrets before using the GitHub integration.",
    );
  }
  return new Octokit({ auth: token });
}
