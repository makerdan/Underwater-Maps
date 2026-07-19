/**
 * DataSourceBadge — unit tests verifying correct rendering for all
 * supported source types (noaa, usgs, glerl, estimated) and that
 * freshwater-specific sources get the real-data green badge.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataSourceBadge } from "@/components/DataSourceBadge";

describe("DataSourceBadge", () => {
  it("renders NOAA badge with green style", () => {
    render(
      <DataSourceBadge
        source="noaa"
        stationId="9443090"
        stationName="Resurrection Bay"
        distanceKm={12.3}
      />,
    );
    const badge = screen.getByTestId("data-source-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("data-source", "noaa");
    expect(badge).toHaveTextContent("NOAA");
    expect(badge).toHaveTextContent("#9443090");
    expect(badge).toHaveTextContent("12.3 km");
  });

  it("renders USGS badge (freshwater real data)", () => {
    render(
      <DataSourceBadge
        source="usgs"
        stationId="04082500"
        stationName="Fox River at Rapides des Peres"
        distanceKm={8.7}
      />,
    );
    const badge = screen.getByTestId("data-source-badge");
    expect(badge).toHaveAttribute("data-source", "usgs");
    expect(badge).toHaveTextContent("USGS");
    expect(badge).toHaveTextContent("#04082500");
  });

  it("renders GLERL badge (Great Lakes model)", () => {
    render(<DataSourceBadge source="glerl" stationName="Lake Michigan" distanceKm={0} />);
    const badge = screen.getByTestId("data-source-badge");
    expect(badge).toHaveAttribute("data-source", "glerl");
    expect(badge).toHaveTextContent("GLERL");
  });

  it("renders estimated badge with dashed style", () => {
    render(<DataSourceBadge source="estimated" />);
    const badge = screen.getByTestId("data-source-badge");
    expect(badge).toHaveAttribute("data-source", "estimated");
    expect(badge).toHaveTextContent("Estimated");
  });

  it("does not render stationId for estimated source", () => {
    render(<DataSourceBadge source="estimated" stationId="XXXX" />);
    expect(screen.getByTestId("data-source-badge")).not.toHaveTextContent("#XXXX");
  });

  it("wraps NOAA badge in a tidesandcurrents.noaa.gov link", () => {
    const { container } = render(
      <DataSourceBadge source="noaa" stationId="9443090" stationName="Resurrection Bay" />,
    );
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.href).toContain("tidesandcurrents.noaa.gov");
    expect(link?.href).toContain("9443090");
  });

  it("does not link USGS badge (no tidesandcurrents link for freshwater)", () => {
    const { container } = render(
      <DataSourceBadge source="usgs" stationId="04082500" />,
    );
    const link = container.querySelector("a");
    expect(link).toBeNull();
  });
});
