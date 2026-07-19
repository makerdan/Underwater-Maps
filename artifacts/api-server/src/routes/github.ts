import { Router, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { validateBody } from "../middlewares/validateBody.js";
import { getGithubClient } from "../lib/github.js";

const GithubOwnerRepoSchema = z.object({
  owner: z.string().min(1, "owner is required").max(100).regex(/^[a-zA-Z0-9_.-]+$/, "owner contains invalid characters"),
  repo: z.string().min(1, "repo is required").max(100).regex(/^[a-zA-Z0-9_.-]+$/, "repo contains invalid characters"),
});

const PutGithubContentsBody = z.object({
  message: z.string({ required_error: "'message' is required", invalid_type_error: "'message' must be a string" }).min(1, "'message' must not be empty"),
  content: z.string({ required_error: "'content' is required", invalid_type_error: "'content' must be a string" }).min(1, "'content' must not be empty"),
  sha: z.string().optional(),
  branch: z.string().optional(),
});

const DeleteGithubContentsBody = z.object({
  message: z.string({ required_error: "'message' is required", invalid_type_error: "'message' must be a string" }).min(1, "'message' must not be empty"),
  sha: z.string({ required_error: "'sha' is required", invalid_type_error: "'sha' must be a string" }).min(1, "'sha' must not be empty"),
  branch: z.string().optional(),
});

const PostGithubDispatchBody = z.object({
  ref: z.string({ required_error: "'ref' is required", invalid_type_error: "'ref' must be a string" }).min(1, "'ref' must not be empty"),
  inputs: z.record(z.string()).optional(),
});

const router = Router();

/**
 * Maps an Octokit (or token-missing) error to a structured JSON response so
 * every failure path returns { error, details } rather than Express's default
 * HTML error page.  Octokit's RequestError carries a numeric .status that
 * mirrors GitHub's HTTP status; fall back to 500 for non-Octokit throws.
 */
function handleGithubError(res: Response, err: unknown): void {
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? (err as { status: unknown }).status
      : undefined;
  const message =
    err instanceof Error ? err.message : "An unexpected error occurred";
  res
    .status(typeof status === "number" ? status : 500)
    .json({ error: "github_error", details: message });
}

/**
 * Returns true if the path contains no `..` traversal segments.
 * Exported for unit testing; also called from route handlers for defense-in-depth.
 */
export function isPathSafe(path: string): boolean {
  return !path.split("/").some((seg) => seg === "..");
}

/**
 * Extracts the wildcard path param and rejects path traversal sequences.
 * Returns { ok: true, path } or { ok: false } (after writing the 400 response).
 */
function extractSafePath(
  params: Record<string, string | string[]>,
  res: Response,
): { ok: true; path: string } | { ok: false } {
  const rawPath = params["path"];
  const path = Array.isArray(rawPath) ? rawPath.join("/") : (rawPath ?? "");
  if (!isPathSafe(path)) {
    res.status(400).json({ error: "invalid_params", details: "path traversal not allowed" });
    return { ok: false };
  }
  return { ok: true, path };
}

/**
 * GET /api/github/repos
 * Lists repositories accessible to the PAT.
 */
router.get(
  "/repos",
  requireAuth,
  asyncHandler(async (_req, res): Promise<void> => {
    let octokit;
    try {
      octokit = getGithubClient();
    } catch (err) {
      handleGithubError(res, err);
      return;
    }
    try {
      const { data } = await octokit.repos.listForAuthenticatedUser({ per_page: 100 });
      res.json(data);
    } catch (err) {
      handleGithubError(res, err);
    }
  }),
);

/**
 * GET /api/github/repos/:owner/:repo/contents/*path
 * Reads a file or lists a directory from the repository.
 */
router.get(
  "/repos/:owner/:repo/contents/*path",
  requireAuth,
  asyncHandler(async (req, res): Promise<void> => {
    const paramsParsed = GithubOwnerRepoSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      res.status(400).json({ error: "invalid_params", details: paramsParsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    const { owner, repo } = paramsParsed.data;
    const pathResult = extractSafePath(req.params as Record<string, string | string[]>, res);
    if (!pathResult.ok) return;
    const { path } = pathResult;
    const ref = typeof req.query["ref"] === "string" ? req.query["ref"] : undefined;

    let octokit;
    try {
      octokit = getGithubClient();
    } catch (err) {
      handleGithubError(res, err);
      return;
    }
    try {
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path,
        ...(ref !== undefined ? { ref } : {}),
      });
      res.json(data);
    } catch (err) {
      handleGithubError(res, err);
    }
  }),
);

/**
 * PUT /api/github/repos/:owner/:repo/contents/*path
 * Creates or updates a file in the repository.
 * Body: { message: string, content: string (base64), sha?: string, branch?: string }
 */
router.put(
  "/repos/:owner/:repo/contents/*path",
  requireAuth,
  validateBody(PutGithubContentsBody, "PUT /api/github/repos/:owner/:repo/contents/*path"),
  asyncHandler(async (req, res): Promise<void> => {
    const paramsParsed = GithubOwnerRepoSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      res.status(400).json({ error: "invalid_params", details: paramsParsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    const { owner, repo } = paramsParsed.data;

    const pathResult = extractSafePath(req.params as Record<string, string | string[]>, res);
    if (!pathResult.ok) return;
    const { path } = pathResult;

    const { message, content, sha, branch } = res.locals.parsedBody;

    let octokit;
    try {
      octokit = getGithubClient();
    } catch (err) {
      handleGithubError(res, err);
      return;
    }
    try {
      const { data } = await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message,
        content,
        ...(sha ? { sha } : {}),
        ...(branch ? { branch } : {}),
      });
      res.json(data);
    } catch (err) {
      handleGithubError(res, err);
    }
  }),
);

/**
 * DELETE /api/github/repos/:owner/:repo/contents/*path
 * Deletes a file from the repository.
 * Body: { message: string, sha: string, branch?: string }
 */
router.delete(
  "/repos/:owner/:repo/contents/*path",
  requireAuth,
  validateBody(DeleteGithubContentsBody, "DELETE /api/github/repos/:owner/:repo/contents/*path"),
  asyncHandler(async (req, res): Promise<void> => {
    const paramsParsed = GithubOwnerRepoSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      res.status(400).json({ error: "invalid_params", details: paramsParsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    const { owner, repo } = paramsParsed.data;

    const pathResult = extractSafePath(req.params as Record<string, string | string[]>, res);
    if (!pathResult.ok) return;
    const { path } = pathResult;

    const { message, sha, branch } = res.locals.parsedBody;

    let octokit;
    try {
      octokit = getGithubClient();
    } catch (err) {
      handleGithubError(res, err);
      return;
    }
    try {
      const { data } = await octokit.repos.deleteFile({
        owner,
        repo,
        path,
        message,
        sha,
        ...(branch ? { branch } : {}),
      });
      res.json(data);
    } catch (err) {
      handleGithubError(res, err);
    }
  }),
);

/**
 * POST /api/github/repos/:owner/:repo/actions/workflows/:workflow_id/dispatches
 * Triggers a workflow_dispatch event for the given workflow.
 * Body: { ref: string, inputs?: Record<string, string> }
 */
router.post(
  "/repos/:owner/:repo/actions/workflows/:workflow_id/dispatches",
  requireAuth,
  validateBody(PostGithubDispatchBody, "POST /api/github/repos/:owner/:repo/actions/workflows/:workflow_id/dispatches"),
  asyncHandler(async (req, res): Promise<void> => {
    const paramsParsed = GithubOwnerRepoSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      res.status(400).json({ error: "invalid_params", details: paramsParsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    const { owner, repo } = paramsParsed.data;
    const params = req.params as Record<string, string>;
    const workflow_id = params["workflow_id"] as string;

    const { ref, inputs } = res.locals.parsedBody;

    let octokit;
    try {
      octokit = getGithubClient();
    } catch (err) {
      handleGithubError(res, err);
      return;
    }
    try {
      await octokit.actions.createWorkflowDispatch({
        owner,
        repo,
        workflow_id,
        ref,
        ...(inputs ? { inputs } : {}),
      });
      res.status(204).send();
    } catch (err) {
      handleGithubError(res, err);
    }
  }),
);

/**
 * GET /api/github/repos/:owner/:repo/actions/runs
 * Lists workflow runs for a repository.
 * Optional query params: workflow_id, status, per_page, page.
 */
router.get(
  "/repos/:owner/:repo/actions/runs",
  requireAuth,
  asyncHandler(async (req, res): Promise<void> => {
    const params = req.params as Record<string, string>;
    const owner = params["owner"] as string;
    const repo = params["repo"] as string;
    const workflow_id =
      typeof req.query["workflow_id"] === "string" ? req.query["workflow_id"] : undefined;
    const status =
      typeof req.query["status"] === "string"
        ? (req.query["status"] as "queued" | "in_progress" | "completed")
        : undefined;
    const per_page =
      typeof req.query["per_page"] === "string"
        ? Number(req.query["per_page"])
        : undefined;
    const page =
      typeof req.query["page"] === "string" ? Number(req.query["page"]) : undefined;

    let octokit;
    try {
      octokit = getGithubClient();
    } catch (err) {
      handleGithubError(res, err);
      return;
    }
    try {
      const { data } = await octokit.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        ...(workflow_id !== undefined ? { workflow_id } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(per_page !== undefined ? { per_page } : {}),
        ...(page !== undefined ? { page } : {}),
      });
      const runs = data.workflow_runs.map((run) => ({
        id: run.id,
        name: run.name,
        status: run.status,
        conclusion: run.conclusion,
        created_at: run.created_at,
        html_url: run.html_url,
        workflow_id: run.workflow_id,
      }));
      res.json({ total_count: data.total_count, workflow_runs: runs });
    } catch (err) {
      handleGithubError(res, err);
    }
  }),
);

/**
 * GET /api/github/repos/:owner/:repo/actions/runs/:run_id
 * Returns a single workflow run by ID.
 */
router.get(
  "/repos/:owner/:repo/actions/runs/:run_id",
  requireAuth,
  asyncHandler(async (req, res): Promise<void> => {
    const params = req.params as Record<string, string>;
    const owner = params["owner"] as string;
    const repo = params["repo"] as string;
    const run_id = Number(params["run_id"] as string);

    if (isNaN(run_id)) {
      res.status(400).json({
        error: "invalid_request",
        details: "'run_id' must be a numeric workflow run ID.",
      });
      return;
    }

    let octokit;
    try {
      octokit = getGithubClient();
    } catch (err) {
      handleGithubError(res, err);
      return;
    }
    try {
      const { data: run } = await octokit.actions.getWorkflowRun({
        owner,
        repo,
        run_id,
      });
      res.json({
        id: run.id,
        name: run.name,
        status: run.status,
        conclusion: run.conclusion,
        created_at: run.created_at,
        html_url: run.html_url,
        workflow_id: run.workflow_id,
      });
    } catch (err) {
      handleGithubError(res, err);
    }
  }),
);

export default router;
