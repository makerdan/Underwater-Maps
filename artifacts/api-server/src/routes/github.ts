import { Router, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { getGithubClient } from "../lib/github.js";

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
    const params = req.params as Record<string, string | string[]>;
    const owner = params["owner"] as string;
    const repo = params["repo"] as string;
    const rawPath = params["path"];
    const path = Array.isArray(rawPath) ? rawPath.join("/") : (rawPath ?? "");
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
  asyncHandler(async (req, res): Promise<void> => {
    const params = req.params as Record<string, string | string[]>;
    const owner = params["owner"] as string;
    const repo = params["repo"] as string;
    const rawPath = params["path"];
    const path = Array.isArray(rawPath) ? rawPath.join("/") : (rawPath ?? "");
    const { message, content, sha, branch } = req.body as {
      message: string;
      content: string;
      sha?: string;
      branch?: string;
    };

    if (!message || !content) {
      res.status(400).json({
        error: "invalid_request",
        details: "Both 'message' (commit message) and 'content' (base64-encoded) are required.",
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
  asyncHandler(async (req, res): Promise<void> => {
    const params = req.params as Record<string, string | string[]>;
    const owner = params["owner"] as string;
    const repo = params["repo"] as string;
    const rawPath = params["path"];
    const path = Array.isArray(rawPath) ? rawPath.join("/") : (rawPath ?? "");
    const { message, sha, branch } = req.body as {
      message: string;
      sha: string;
      branch?: string;
    };

    if (!message || !sha) {
      res.status(400).json({
        error: "invalid_request",
        details: "Both 'message' (commit message) and 'sha' (blob SHA) are required.",
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
  asyncHandler(async (req, res): Promise<void> => {
    const params = req.params as Record<string, string>;
    const owner = params["owner"] as string;
    const repo = params["repo"] as string;
    const workflow_id = params["workflow_id"] as string;
    const { ref, inputs } = req.body as {
      ref: string;
      inputs?: Record<string, string>;
    };

    if (!ref) {
      res.status(400).json({
        error: "invalid_request",
        details: "'ref' (branch or tag name) is required.",
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

export default router;
