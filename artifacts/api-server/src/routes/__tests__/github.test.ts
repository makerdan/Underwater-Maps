/**
 * github.test.ts — integration tests for the GitHub proxy routes.
 *
 * Covers:
 *   GET  /repos                         — list repos
 *   GET  /repos/:owner/:repo/contents/*  — read file/dir
 *   PUT  /repos/:owner/:repo/contents/*  — create/update file
 *   DELETE /repos/:owner/:repo/contents/* — delete file
 *   POST /repos/:owner/:repo/actions/workflows/:wf/dispatches — trigger workflow
 *   GET  /repos/:owner/:repo/actions/runs — list runs
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const octokitMock = {
  repos: {
    listForAuthenticatedUser: vi.fn(),
    getContent: vi.fn(),
    createOrUpdateFileContents: vi.fn(),
    deleteFile: vi.fn(),
  },
  actions: {
    createWorkflowDispatch: vi.fn(),
    listWorkflowRunsForRepo: vi.fn(),
    getWorkflowRun: vi.fn(),
  },
};

vi.mock("../../lib/github.js", () => ({
  getGithubClient: vi.fn(() => octokitMock),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: null })),
}));

import githubRouter from "../github.js";
import { getGithubClient } from "../../lib/github.js";

const getGithubClientMock = getGithubClient as ReturnType<typeof vi.fn>;

const E2E_USER = "user_e2e_github_test";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(githubRouter);
  return app;
}

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  octokitMock.repos.listForAuthenticatedUser.mockReset();
  octokitMock.repos.getContent.mockReset();
  octokitMock.repos.createOrUpdateFileContents.mockReset();
  octokitMock.repos.deleteFile.mockReset();
  octokitMock.actions.createWorkflowDispatch.mockReset();
  octokitMock.actions.listWorkflowRunsForRepo.mockReset();
  octokitMock.actions.getWorkflowRun.mockReset();
  getGithubClientMock.mockReturnValue(octokitMock);
});

describe("GET /repos — list repositories", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "0");
    const res = await request(makeApp()).get("/repos");
    expect(res.status).toBe(401);
  });

  it("returns repos from Octokit", async () => {
    octokitMock.repos.listForAuthenticatedUser.mockResolvedValue({
      data: [{ id: 1, name: "my-repo", full_name: "owner/my-repo" }],
    });
    const res = await request(makeApp())
      .get("/repos")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("returns github_error when GITHUB_TOKEN is missing", async () => {
    getGithubClientMock.mockImplementation(() => {
      throw new Error("GITHUB_TOKEN not set");
    });
    const res = await request(makeApp())
      .get("/repos")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("github_error");
  });
});

describe("GET /repos/:owner/:repo/contents/*path — read file", () => {
  it("returns 400 for invalid owner characters", async () => {
    const res = await request(makeApp())
      .get("/repos/bad owner/repo/contents/README.md")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });

  it("returns file content on success", async () => {
    octokitMock.repos.getContent.mockResolvedValue({
      data: { type: "file", name: "README.md", content: "aGVsbG8=" },
    });
    const res = await request(makeApp())
      .get("/repos/owner/repo/contents/README.md")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("name", "README.md");
  });
});

describe("PUT /repos/:owner/:repo/contents/*path — create/update file", () => {
  it("returns 400 when message is missing", async () => {
    const res = await request(makeApp())
      .put("/repos/owner/repo/contents/file.txt")
      .set("x-e2e-user-id", E2E_USER)
      .send({ content: "aGVsbG8=" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 400 when content is missing", async () => {
    const res = await request(makeApp())
      .put("/repos/owner/repo/contents/file.txt")
      .set("x-e2e-user-id", E2E_USER)
      .send({ message: "add file" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns file result on success", async () => {
    octokitMock.repos.createOrUpdateFileContents.mockResolvedValue({
      data: { commit: { sha: "abc123" }, content: { name: "file.txt" } },
    });
    const res = await request(makeApp())
      .put("/repos/owner/repo/contents/file.txt")
      .set("x-e2e-user-id", E2E_USER)
      .send({ message: "add file", content: "aGVsbG8=" });
    expect(res.status).toBe(200);
  });
});

describe("DELETE /repos/:owner/:repo/contents/*path — delete file", () => {
  it("returns 400 when message is missing", async () => {
    const res = await request(makeApp())
      .delete("/repos/owner/repo/contents/file.txt")
      .set("x-e2e-user-id", E2E_USER)
      .send({ sha: "abc123" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 400 when sha is missing", async () => {
    const res = await request(makeApp())
      .delete("/repos/owner/repo/contents/file.txt")
      .set("x-e2e-user-id", E2E_USER)
      .send({ message: "delete file" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });
});

describe("POST /repos/:owner/:repo/actions/workflows/:workflow_id/dispatches", () => {
  it("returns 400 when ref is missing", async () => {
    const res = await request(makeApp())
      .post("/repos/owner/repo/actions/workflows/deploy/dispatches")
      .set("x-e2e-user-id", E2E_USER)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 204 on success", async () => {
    octokitMock.actions.createWorkflowDispatch.mockResolvedValue({});
    const res = await request(makeApp())
      .post("/repos/owner/repo/actions/workflows/deploy/dispatches")
      .set("x-e2e-user-id", E2E_USER)
      .send({ ref: "main" });
    expect(res.status).toBe(204);
  });
});

describe("GET /repos/:owner/:repo/actions/runs — list workflow runs", () => {
  it("returns runs list on success", async () => {
    octokitMock.actions.listWorkflowRunsForRepo.mockResolvedValue({
      data: {
        total_count: 1,
        workflow_runs: [{
          id: 42,
          name: "CI",
          status: "completed",
          conclusion: "success",
          created_at: "2026-01-01T00:00:00Z",
          html_url: "https://github.com",
          workflow_id: 1,
        }],
      },
    });
    const res = await request(makeApp())
      .get("/repos/owner/repo/actions/runs")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(200);
    expect(res.body.total_count).toBe(1);
    expect(res.body.workflow_runs).toHaveLength(1);
  });
});
