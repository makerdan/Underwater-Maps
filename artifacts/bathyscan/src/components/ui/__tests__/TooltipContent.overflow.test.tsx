import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../tooltip";

const LONG_TEXT =
  "This is an extremely long tooltip string that would definitely overflow the screen edge if word-wrap and max-width constraints were not applied to the tooltip content element";

function renderTooltip(className?: string) {
  return render(
    <TooltipProvider>
      <Tooltip open>
        <TooltipTrigger asChild>
          <button>hover me</button>
        </TooltipTrigger>
        <TooltipContent className={className}>{LONG_TEXT}</TooltipContent>
      </Tooltip>
    </TooltipProvider>,
    { baseElement: document.body }
  );
}

describe("TooltipContent — overflow-guard classes", () => {
  it("applies max-w-xs to prevent the tooltip from exceeding a readable width", () => {
    renderTooltip();
    const el = document.body.querySelector("[data-radix-popper-content-wrapper] *[class]");
    expect(el?.className).toContain("max-w-xs");
  });

  it("applies whitespace-normal so long text wraps instead of stretching the box", () => {
    renderTooltip();
    const el = document.body.querySelector("[data-radix-popper-content-wrapper] *[class]");
    expect(el?.className).toContain("whitespace-normal");
  });

  it("applies break-words so unbreakable strings (URLs, hashes) cannot overflow", () => {
    renderTooltip();
    const el = document.body.querySelector("[data-radix-popper-content-wrapper] *[class]");
    expect(el?.className).toContain("break-words");
  });

  it("preserves all three overflow-guard classes when a custom className is merged in", () => {
    renderTooltip("my-custom-class");
    const el = document.body.querySelector("[data-radix-popper-content-wrapper] *[class]");
    const cls = el?.className ?? "";
    expect(cls).toContain("max-w-xs");
    expect(cls).toContain("whitespace-normal");
    expect(cls).toContain("break-words");
    expect(cls).toContain("my-custom-class");
  });
});
