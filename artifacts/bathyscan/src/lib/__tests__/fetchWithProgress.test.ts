import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchJsonWithProgress } from "@/lib/fetchWithProgress";

function makeStreamResponse(
  chunks: Uint8Array[],
  { contentLength }: { contentLength?: number | null } = {},
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (contentLength != null) headers.set("content-length", String(contentLength));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers });
}

const enc = new TextEncoder();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchJsonWithProgress", () => {
  it("emits monotonic progress events and resolves with the parsed JSON", async () => {
    const payload = { hello: "world", n: 42 };
    const json = JSON.stringify(payload);
    const half = Math.floor(json.length / 2);
    const c1 = enc.encode(json.slice(0, half));
    const c2 = enc.encode(json.slice(half));
    const total = c1.byteLength + c2.byteLength;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeStreamResponse([c1, c2], { contentLength: total }),
      ),
    );
    const events: { loaded: number; total: number | null }[] = [];
    const result = await fetchJsonWithProgress<typeof payload>("/x", {
      onProgress: (e) => events.push({ ...e }),
    });
    expect(result).toEqual(payload);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]!.loaded).toBe(0);
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.loaded).toBeGreaterThanOrEqual(events[i - 1]!.loaded);
    }
    expect(events.at(-1)!.loaded).toBe(total);
    expect(events.at(-1)!.total).toBe(total);
  });

  it("reports null total when no content-length header is present", async () => {
    const c1 = enc.encode("[1");
    const c2 = enc.encode(",2,3]");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeStreamResponse([c1, c2])),
    );
    const events: { loaded: number; total: number | null }[] = [];
    const result = await fetchJsonWithProgress<number[]>("/x", {
      onProgress: (e) => events.push({ ...e }),
    });
    expect(result).toEqual([1, 2, 3]);
    expect(events.every((e) => e.total === null)).toBe(true);
  });

  it("rejects when aborted mid-stream", async () => {
    const controller = new AbortController();
    const ac = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode("{"));
        // never close; abort will tear it down
        ac.signal.addEventListener("abort", () => {
          try {
            c.error(new DOMException("aborted", "AbortError"));
          } catch {
            /* already closed */
          }
        });
      },
    });
    // Swallow the synthetic unhandled rejection that jsdom + Node surface
    // from the aborted ReadableStream — the test only cares that the outer
    // promise rejects. Vitest watches Node's process-level event, not jsdom's
    // window event, so we register on both.
    const onUnhandled = (e: PromiseRejectionEvent) => {
      if (e.reason?.name === "AbortError") e.preventDefault();
    };
    window.addEventListener("unhandledrejection", onUnhandled);
    const onNodeUnhandled = (reason: unknown) => {
      if ((reason as { name?: string } | null)?.name === "AbortError") {
        // no-op: handled by the outer `await expect(p).rejects` below
      }
    };
    process.on("unhandledRejection", onNodeUnhandled);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init: RequestInit | undefined) => {
        init?.signal?.addEventListener("abort", () => ac.abort());
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    );
    const p = fetchJsonWithProgress("/x", { signal: controller.signal });
    controller.abort();
    await expect(p).rejects.toBeDefined();
  });

  it("throws on non-2xx responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("nope", { status: 500, statusText: "Server Error" }),
      ),
    );
    await expect(fetchJsonWithProgress("/x")).rejects.toThrow(/500/);
  });
});
