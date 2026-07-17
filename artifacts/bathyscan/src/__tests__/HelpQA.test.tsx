import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import { HelpQA } from "@/components/help/HelpQA";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  // jsdom doesn't implement Element.prototype.scrollTo — HelpQA calls it
  // inside a useEffect on every message change.
  if (!("scrollTo" in Element.prototype) || typeof Element.prototype.scrollTo !== "function") {
    Element.prototype.scrollTo = vi.fn() as unknown as Element["scrollTo"];
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function okResponse(answer: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ answer }),
  } as unknown as Response;
}

function rateLimitResponse() {
  return {
    ok: false,
    status: 429,
    json: async () => ({ error: "rate_limit", details: "Too many requests — please wait a moment." }),
  } as unknown as Response;
}

describe("HelpQA", () => {
  it("clicking a starter question appends user + assistant messages", async () => {
    fetchMock.mockResolvedValueOnce(okResponse("Use the Drift Planner in the Plan tab."));

    render(<HelpQA />);

    const starter = screen.getByRole("button", { name: /How do I use the Drift Planner\?/i });
    await act(async () => {
      fireEvent.click(starter);
    });

    await waitFor(() => {
      expect(screen.getByText(/Use the Drift Planner in the Plan tab\./)).toBeInTheDocument();
    });
    expect(screen.getByText(/How do I use the Drift Planner\?/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      question: "How do I use the Drift Planner?",
    });
  });

  it("clear button wipes the thread and brings back the starter prompts", async () => {
    fetchMock.mockResolvedValueOnce(okResponse("Click Explore, Plan, or Analyze at the top of the sidebar."));

    render(<HelpQA />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /How do I switch between Explore, Plan, and Analyze modes\?/i }));
    });
    await waitFor(() => {
      expect(screen.getByText(/Click Explore, Plan, or Analyze at the top of the sidebar\./)).toBeInTheDocument();
    });

    const clearBtn = screen.getByRole("button", { name: /^Clear$/ });
    fireEvent.click(clearBtn);

    await waitFor(() => {
      expect(screen.queryByText(/Click Explore, Plan, or Analyze at the top of the sidebar\./)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Try a starter question:/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /How do I switch between Explore, Plan, and Analyze modes\?/i }),
    ).toBeInTheDocument();
  });

  it("surfaces the rate-limit message when the endpoint returns 429", async () => {
    fetchMock.mockResolvedValueOnce(rateLimitResponse());

    render(<HelpQA />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /How do I use the Drift Planner\?/i }));
    });

    await waitFor(() => {
      expect(
        screen.getByText(/reached the AI usage limit/i),
      ).toBeInTheDocument();
    });
    // No assistant message should have been appended on the 429 path.
    expect(screen.queryByText(/^Assistant$/)).not.toBeInTheDocument();
  });
});
