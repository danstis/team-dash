import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EmptyDashboard } from "../../../../src/features/refresh/EmptyDashboard";

afterEach(() => {
  cleanup();
});

describe("EmptyDashboard", () => {
  it("renders the documented data-testid and data-view-state anchors", () => {
    render(<EmptyDashboard />);

    const section = screen.getByTestId("empty-dashboard");
    expect(section).toHaveAttribute("data-view-state", "empty");
    expect(section.tagName.toLowerCase()).toBe("section");
  });

  it("directs the first-run user to press the Refresh button (FR-085)", () => {
    render(<EmptyDashboard />);
    // The copy MUST mention "Refresh" so a user reading the empty
    // surface knows the next action. Test pins the literal so a
    // future copy change is intentional.
    expect(screen.getByTestId("empty-dashboard")).toHaveTextContent(
      /Refresh/i,
    );
  });

  it("uses role='status' + aria-live='polite' (informational, not alert)", () => {
    render(<EmptyDashboard />);
    const section = screen.getByTestId("empty-dashboard");
    expect(section).toHaveAttribute("role", "status");
    expect(section).toHaveAttribute("aria-live", "polite");
  });

  it("renders an a11y label that screen readers can announce", () => {
    render(<EmptyDashboard />);
    expect(screen.getByTestId("empty-dashboard")).toHaveAttribute(
      "aria-label",
      "No data yet",
    );
  });

  it("renders an h2 heading so the surface respects the page heading outline", () => {
    render(<EmptyDashboard />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "No data yet",
    );
  });
});
