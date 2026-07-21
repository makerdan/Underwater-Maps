/**
 * githubAllowlist.ts — federated connector for a curated allowlist of
 * GitHub orgs/users that publish open bathymetry data or tooling.
 *
 * Uses the unauthenticated GitHub repository search API (verified live
 * 2026-07-21) with `user:` qualifiers so results are constrained to the
 * allowlist in a single request:
 *
 *   GET https://api.github.com/search/repositories
 *       ?q=<query> user:a user:b …&per_page=10
 *
 * Results are link-only unless the repo exposes a parseable endpoint —
 * importability still flows through deriveImportability(), which never
 * matches github.com URLs, so the badge stays honest automatically.
 *
 * Rate limit: 10 requests/min unauthenticated — the federated route's
 * response cache keeps traffic well under that.
 */

import { deriveImportability } from "../importable.js";
import type { FederatedBbox, FederatedConnector, FederatedResultItem } from "../types.js";

const GITHUB_SEARCH_URL = "https://api.github.com/search/repositories";
const MAX_RESULTS = 10;

/** Orgs/users verified to exist on GitHub (checked live 2026-07-21). */
export const GITHUB_ALLOWLIST_USERS = [
  "noaa-ocs-hydrography", // NOAA Office of Coast Survey hydrography
  "ICESat2-Bathymetry",   // NASA ICESat-2 bathymetry community
  "ngdc",                 // NOAA National Geophysical Data Center legacy org
  "dwcaress",             // MB-System author (open multibeam processing)
  "osu-mgr",              // Oregon State Marine Geology Repository
] as const;

interface GithubRepoItem {
  id?: number;
  full_name?: string;
  name?: string;
  description?: string | null;
  html_url?: string;
}

interface GithubSearchResponse {
  total_count?: number;
  items?: GithubRepoItem[];
  message?: string;
}

export const githubAllowlistConnector: FederatedConnector = {
  id: "github-allowlist",
  label: "GitHub (open bathymetry repos)",

  async search(
    q: string,
    _bbox: FederatedBbox | null,
    signal: AbortSignal,
  ): Promise<FederatedResultItem[]> {
    const userQualifiers = GITHUB_ALLOWLIST_USERS.map((u) => `user:${u}`).join(" ");
    const params = new URLSearchParams({
      q: `${q || "bathymetry"} ${userQualifiers}`,
      per_page: String(MAX_RESULTS),
      sort: "stars",
    });
    const resp = await fetch(`${GITHUB_SEARCH_URL}?${params.toString()}`, {
      signal,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "BathyScan-FederatedSearch",
      },
    });
    if (!resp.ok) {
      // 403/429 = rate limited — surfaced as a per-source error, non-fatal.
      throw new Error(`GitHub search returned HTTP ${resp.status}`);
    }
    const raw = (await resp.json()) as GithubSearchResponse;

    const out: FederatedResultItem[] = [];
    for (const repo of raw.items ?? []) {
      const fullName = repo.full_name?.trim();
      if (!fullName || !repo.html_url) continue;
      const { importable, importKind } = deriveImportability({
        id: `github-${fullName}`,
        endpointUrl: null, // repos have no direct raster endpoint
        coverageBbox: null,
      });
      out.push({
        id: `github-allowlist:${fullName}`,
        sourceId: "github-allowlist",
        sourceLabel: "GitHub (open bathymetry repos)",
        name: fullName,
        description: repo.description?.trim() || null,
        url: repo.html_url,
        endpointUrl: null,
        coverageBbox: null,
        resolutionMMin: null,
        resolutionMMax: null,
        importable,
        importKind,
      });
    }
    return out;
  },
};
