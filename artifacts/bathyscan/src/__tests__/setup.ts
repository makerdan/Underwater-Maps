import { vi } from "vitest";

class MockCanvas {
  width = 0;
  height = 0;
  getContext() {
    return {
      fillStyle: "",
      fillRect: vi.fn(),
    };
  }
}

vi.stubGlobal("document", {
  createElement: (tag: string) => {
    if (tag === "canvas") return new MockCanvas();
    return {};
  },
});
