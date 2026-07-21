/**
 * federated-runner.test.ts — unit tests for the federated search fan-out
 * engine: concurrent execution, per-source timeout, non-fatal failures,
 * merge ordering, and per-source status reporting.
 */

import { describe, it, expect } from "vitest";
import { runFederatedSearch } from "../lib/federatedSearch/runner.js";
import type {
  FederatedConnector,
  FederatedResultItem,
} from "../lib/federatedSearch/types.js";

function makeItem(sourceId: string, n: number): FederatedResultItem {
  return {
    id: `${sourceId}:item-${n}`,
    sourceId,
    sourceLabel: sourceId,
    name: `Result ${n} from ${sourceId}`,
    description: null,
    url: null,
    endpointUrl: null,
    coverageBbox: null,
    resolutionMMin: null,
    resolutionMMax: null,
    importable: false,
    importKind: null,
  };
}

function okConnector(id: string, count: number, delayMs = 0): FederatedConnector {
  return {
    id,
    label: `Label ${id}`,
    async search() {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return Array.from({ length: count }, (_, i) => makeItem(id, i));
    },
  };
}

function errorConnector(id: string, message: string): FederatedConnector {
  return {
    id,
    label: `Label ${id}`,
    async search() {
      throw new Error(message);
    },
  };
}

/** Connector that only resolves when its abort signal fires (forces timeout). */
function hangingConnector(id: string): FederatedConnector {
  return {
    id,
    label: `Label ${id}`,
    search(_q, _bbox, signal) {
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    },
  };
}

describe("runFederatedSearch", () => {
  it("merges results from all successful connectors in registration order", async () => {
    const res = await runFederatedSearch("test", null, {
      connectors: [okConnector("a", 2), okConnector("b", 1)],
    });
    expect(res.results.map((r) => r.id)).toEqual([
      "a:item-0",
      "a:item-1",
      "b:item-0",
    ]);
    expect(res.sources).toHaveLength(2);
    expect(res.sources.every((s) => s.status === "ok")).toBe(true);
    expect(res.sources[0]).toMatchObject({
      sourceId: "a",
      label: "Label a",
      resultCount: 2,
      error: null,
    });
  });

  it("a failing connector is non-fatal and reports an error status", async () => {
    const res = await runFederatedSearch("test", null, {
      connectors: [errorConnector("bad", "HTTP 500"), okConnector("good", 1)],
    });
    expect(res.results).toHaveLength(1);
    expect(res.results[0]!.sourceId).toBe("good");
    const bad = res.sources.find((s) => s.sourceId === "bad")!;
    expect(bad.status).toBe("error");
    expect(bad.error).toBe("HTTP 500");
    expect(bad.resultCount).toBe(0);
    const good = res.sources.find((s) => s.sourceId === "good")!;
    expect(good.status).toBe("ok");
  });

  it("a hanging connector times out without sinking the search", async () => {
    const res = await runFederatedSearch("test", null, {
      connectors: [hangingConnector("slow"), okConnector("fast", 1)],
      timeoutMs: 50,
    });
    expect(res.results).toHaveLength(1);
    const slow = res.sources.find((s) => s.sourceId === "slow")!;
    expect(slow.status).toBe("timeout");
    expect(slow.error).toMatch(/timed out/i);
    expect(slow.tookMs).toBeGreaterThanOrEqual(40);
  });

  it("caps each source at 20 results", async () => {
    const res = await runFederatedSearch("test", null, {
      connectors: [okConnector("chatty", 50)],
    });
    expect(res.results).toHaveLength(20);
    expect(res.sources[0]!.resultCount).toBe(20);
  });

  it("runs connectors concurrently, not serially", async () => {
    const started = Date.now();
    await runFederatedSearch("test", null, {
      connectors: [
        okConnector("d1", 1, 100),
        okConnector("d2", 1, 100),
        okConnector("d3", 1, 100),
      ],
    });
    // Serial would be >= 300 ms; concurrent should finish well under 250 ms.
    expect(Date.now() - started).toBeLessThan(250);
  });

  it("passes q and bbox through to connectors", async () => {
    let seenQ = "";
    let seenBbox: unknown = undefined;
    const spy: FederatedConnector = {
      id: "spy",
      label: "Spy",
      async search(q, bbox) {
        seenQ = q;
        seenBbox = bbox;
        return [];
      },
    };
    const bbox = { minLon: -120.2, minLat: 38.9, maxLon: -119.9, maxLat: 39.3 };
    await runFederatedSearch("lake tahoe", bbox, { connectors: [spy] });
    expect(seenQ).toBe("lake tahoe");
    expect(seenBbox).toEqual(bbox);
  });
});
