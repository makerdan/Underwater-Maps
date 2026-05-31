import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LocationBadge } from "@/components/LocationBadge";

/**
 * Unit tests for the LocationBadge component.
 *
 * LocationBadge has three visual states:
 *   • loading  — first fetch in-flight;  data-state="loading"
 *   • fetching — background refresh;      data-state="fetching"
 *   • ready    — data current;            data-state="ready"
 *
 * It uses data-testid="location-badge" and the data-state attribute so that
 * E2E and unit tests can assert on state without coupling to CSS class names.
 */

describe("LocationBadge", () => {
  describe("null guard", () => {
    it("renders nothing when lat is null", () => {
      const { container } = render(
        <LocationBadge datasetName="Test" lat={null} lon={-122.3} isLoading={false} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders nothing when lon is null", () => {
      const { container } = render(
        <LocationBadge datasetName="Test" lat={47.5} lon={null} isLoading={false} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders nothing when both lat and lon are null", () => {
      const { container } = render(
        <LocationBadge datasetName="Test" lat={null} lon={null} isLoading={false} />,
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe("loading state (isLoading=true)", () => {
    it("renders the badge with data-testid and data-state=loading", () => {
      render(
        <LocationBadge
          datasetName="Thorne Bay"
          lat={55.7}
          lon={-132.5}
          isLoading={true}
        />,
      );
      const badge = screen.getByTestId("location-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute("data-state", "loading");
    });

    it("shows the 'Updating…' label in loading state", () => {
      render(
        <LocationBadge
          datasetName="Thorne Bay"
          lat={55.7}
          lon={-132.5}
          isLoading={true}
        />,
      );
      expect(screen.getByTestId("location-badge")).toHaveTextContent("Updating…");
    });

    it("loading state takes priority over isFetching=true", () => {
      render(
        <LocationBadge
          datasetName="Thorne Bay"
          lat={55.7}
          lon={-132.5}
          isLoading={true}
          isFetching={true}
        />,
      );
      const badge = screen.getByTestId("location-badge");
      expect(badge).toHaveAttribute("data-state", "loading");
      expect(badge).toHaveTextContent("Updating…");
    });
  });

  describe("fetching state (isLoading=false, isFetching=true)", () => {
    it("renders the badge with data-state=fetching", () => {
      render(
        <LocationBadge
          datasetName="Thorne Bay"
          lat={55.7}
          lon={-132.5}
          isLoading={false}
          isFetching={true}
        />,
      );
      const badge = screen.getByTestId("location-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute("data-state", "fetching");
    });

    it("shows dataset name and formatted coordinates in fetching state", () => {
      render(
        <LocationBadge
          datasetName="Thorne Bay"
          lat={55.7}
          lon={-132.5}
          isLoading={false}
          isFetching={true}
        />,
      );
      const badge = screen.getByTestId("location-badge");
      expect(badge).toHaveTextContent("Thorne Bay");
      expect(badge).toHaveTextContent("55.7°N");
      expect(badge).toHaveTextContent("132.5°W");
    });

    it("shows coordinates without dataset prefix when datasetName is undefined", () => {
      render(
        <LocationBadge
          datasetName={undefined}
          lat={55.7}
          lon={-132.5}
          isLoading={false}
          isFetching={true}
        />,
      );
      const badge = screen.getByTestId("location-badge");
      expect(badge).toHaveAttribute("data-state", "fetching");
      expect(badge).toHaveTextContent("55.7°N");
      expect(badge).toHaveTextContent("132.5°W");
    });
  });

  describe("ready state (isLoading=false, isFetching=false or absent)", () => {
    it("renders the badge with data-state=ready", () => {
      render(
        <LocationBadge
          datasetName="Thorne Bay"
          lat={55.7}
          lon={-132.5}
          isLoading={false}
        />,
      );
      const badge = screen.getByTestId("location-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute("data-state", "ready");
    });

    it("shows dataset name and formatted coordinates in ready state", () => {
      render(
        <LocationBadge
          datasetName="Thorne Bay"
          lat={55.7}
          lon={-132.5}
          isLoading={false}
        />,
      );
      const badge = screen.getByTestId("location-badge");
      expect(badge).toHaveTextContent("Thorne Bay");
      expect(badge).toHaveTextContent("55.7°N");
      expect(badge).toHaveTextContent("132.5°W");
    });

    it("treats explicit isFetching=false the same as absent (ready state)", () => {
      render(
        <LocationBadge
          datasetName="Thorne Bay"
          lat={55.7}
          lon={-132.5}
          isLoading={false}
          isFetching={false}
        />,
      );
      expect(screen.getByTestId("location-badge")).toHaveAttribute("data-state", "ready");
    });

    it("shows coordinates without dataset prefix when datasetName is undefined", () => {
      render(
        <LocationBadge
          datasetName={undefined}
          lat={55.7}
          lon={-132.5}
          isLoading={false}
        />,
      );
      const badge = screen.getByTestId("location-badge");
      expect(badge).toHaveAttribute("data-state", "ready");
      expect(badge).toHaveTextContent("55.7°N");
      expect(badge).toHaveTextContent("132.5°W");
    });
  });

  describe("coordinate formatting", () => {
    it("formats positive lat as °N", () => {
      render(<LocationBadge datasetName="A" lat={47.5} lon={10.0} isLoading={false} />);
      expect(screen.getByTestId("location-badge")).toHaveTextContent("47.5°N");
    });

    it("formats negative lat as °S with absolute value", () => {
      render(<LocationBadge datasetName="A" lat={-33.9} lon={10.0} isLoading={false} />);
      expect(screen.getByTestId("location-badge")).toHaveTextContent("33.9°S");
    });

    it("formats positive lon as °E", () => {
      render(<LocationBadge datasetName="A" lat={35.0} lon={139.7} isLoading={false} />);
      expect(screen.getByTestId("location-badge")).toHaveTextContent("139.7°E");
    });

    it("formats negative lon as °W with absolute value", () => {
      render(<LocationBadge datasetName="A" lat={35.0} lon={-122.3} isLoading={false} />);
      expect(screen.getByTestId("location-badge")).toHaveTextContent("122.3°W");
    });

    it("rounds coordinates to one decimal place", () => {
      render(<LocationBadge datasetName="A" lat={47.567} lon={-122.345} isLoading={false} />);
      const badge = screen.getByTestId("location-badge");
      expect(badge).toHaveTextContent("47.6°N");
      expect(badge).toHaveTextContent("122.3°W");
    });
  });

  describe("TidePanel embedded vs standalone rendering", () => {
    it("badge is present in ready state regardless of props wiring (standalone path: passes lat/lon directly)", () => {
      render(
        <LocationBadge
          datasetName="Mock Bay"
          lat={48.1}
          lon={-124.7}
          isLoading={false}
        />,
      );
      const badge = screen.getByTestId("location-badge");
      expect(badge).toHaveAttribute("data-state", "ready");
      expect(badge).toHaveTextContent("Mock Bay");
      expect(badge).toHaveTextContent("48.1°N");
      expect(badge).toHaveTextContent("124.7°W");
    });

    it("badge shows loading state in TidePanel's loading=true scenario (when first tidal fetch is in-flight)", () => {
      render(
        <LocationBadge
          datasetName="Mock Bay"
          lat={48.1}
          lon={-124.7}
          isLoading={true}
        />,
      );
      const badge = screen.getByTestId("location-badge");
      expect(badge).toHaveAttribute("data-state", "loading");
      expect(badge).toHaveTextContent("Updating…");
    });
  });
});
