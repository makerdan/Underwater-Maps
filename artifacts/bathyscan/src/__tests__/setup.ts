import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, vi } from "vitest";
import { cleanup, render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";

if (typeof window !== "undefined") {
  Object.defineProperty(window, "innerWidth",  { writable: true, configurable: true, value: 1024 });
  Object.defineProperty(window, "innerHeight", { writable: true, configurable: true, value: 768 });
}

if (typeof global !== "undefined" && !(global as unknown as Record<string, unknown>)["ResizeObserver"]) {
  (global as unknown as Record<string, unknown>)["ResizeObserver"] = vi.fn(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
}

if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

export function renderWithProviders(
  ui: React.ReactElement,
  options?: RenderOptions,
): RenderResult {
  return render(ui, {
    wrapper: ({ children }) => React.createElement(TooltipProvider, null, children),
    ...options,
  });
}

afterEach(() => {
  cleanup();
});

if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.toDataURL = vi.fn(
    () => "data:image/png;base64,",
  ) as unknown as HTMLCanvasElement["toDataURL"];
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    fillStyle: "",
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    drawImage: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    setTransform: vi.fn(),
    scale: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    putImageData: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    createImageData: vi.fn((w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    })),
    shadowColor: "",
    shadowBlur: 0,
  })) as unknown as HTMLCanvasElement["getContext"];
}
