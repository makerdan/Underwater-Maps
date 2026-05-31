import { describe, it, expect } from "vitest";
import { validateHelpInput } from "../HelpQA";

describe("validateHelpInput", () => {
  it("returns null for an empty string", () => {
    expect(validateHelpInput("")).toBeNull();
  });

  it("returns null for a whitespace-only string", () => {
    expect(validateHelpInput("   ")).toBeNull();
  });

  it("returns null for a tab-only string", () => {
    expect(validateHelpInput("\t\t")).toBeNull();
  });

  it("returns null for a newline-only string", () => {
    expect(validateHelpInput("\n")).toBeNull();
  });

  it("returns the trimmed value for a valid question", () => {
    expect(validateHelpInput("How do I drop a marker?")).toBe("How do I drop a marker?");
  });

  it("trims leading and trailing whitespace from a valid question", () => {
    expect(validateHelpInput("  What is the AI assistant for?  ")).toBe(
      "What is the AI assistant for?",
    );
  });

  it("returns the trimmed value for a single word", () => {
    expect(validateHelpInput("depth")).toBe("depth");
  });

  it("does not trim internal whitespace", () => {
    expect(validateHelpInput("  hello   world  ")).toBe("hello   world");
  });
});
