import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TemperatureProfileChart } from "@/components/TemperatureProfileChart";
import type { TemperatureProfile } from "@/lib/waterTemp";

const baseProfile: Omit<TemperatureProfile, "samples"> = {
  surfaceC: 18,
  deepC: 6,
  maxDepthM: 100,
  source: "Model",
  sourceUrl: null,
  timestamp: null,
  live: false,
  model: "exponential-thermocline",
};

describe("TemperatureProfileChart", () => {
  it("renders nothing (no crash) when samples is empty", () => {
    const profile: TemperatureProfile = { ...baseProfile, samples: [] };
    const { container } = render(
      <TemperatureProfileChart profile={profile} units="metric" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the chart when samples are present", () => {
    const profile: TemperatureProfile = {
      ...baseProfile,
      samples: [
        { depthM: 0, celsius: 18 },
        { depthM: 50, celsius: 10 },
        { depthM: 100, celsius: 6 },
      ],
    };
    const { container } = render(
      <TemperatureProfileChart profile={profile} units="metric" />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
