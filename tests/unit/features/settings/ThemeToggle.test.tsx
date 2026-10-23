/**
 * BSOD-359 — `ThemeToggle` unit tests.
 *
 * Pins the Settings interaction: three labelled, keyboard-operable
 * radio options that reflect the stored preference on mount, and that
 * update the `data-theme` attribute and `localStorage` the instant one
 * is selected — no page reload, no extra confirmation step (unlike the
 * credential `StorageModeSelector`, there is no sensitive-data
 * disclosure to gate behind a dialog here).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ThemeToggle } from "../../../../src/features/settings/ThemeToggle";

const STORAGE_KEY = "team-dash:theme-preference";

describe("BSOD-359 ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("renders a labelled group with System, Light, and Dark options", () => {
    render(<ThemeToggle />);

    expect(screen.getByRole("group", { name: /theme/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Light" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Dark" })).not.toBeChecked();
  });

  it("reflects a previously stored preference on mount", () => {
    localStorage.setItem(STORAGE_KEY, "dark");

    render(<ThemeToggle />);

    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "System" })).not.toBeChecked();
  });

  it("applies the theme immediately on selection, with no reload", () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));

    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("persists the selection so it survives a remount (reload simulation)", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(localStorage.getItem(STORAGE_KEY)).toBe("light");
    cleanup();

    render(<ThemeToggle />);
    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
  });

  it("clears data-theme when switching back to System", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    fireEvent.click(screen.getByRole("radio", { name: "System" }));

    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
