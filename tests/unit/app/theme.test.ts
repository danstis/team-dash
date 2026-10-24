/**
 * BSOD-359 — `src/app/theme.ts` unit tests.
 *
 * Pins the three responsibilities the BSOD-356 `data-theme` hook needs
 * from a toggle: read the stored preference (defaulting to `"system"`
 * for a first-time user or unreadable storage), persist a choice (or
 * clear it for `"system"`), and stamp/clear the `<html data-theme>`
 * attribute the CSS already reacts to.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyThemePreference,
  readStoredThemePreference,
  storeThemePreference,
} from "../../../src/app/theme";

const STORAGE_KEY = "team-dash:theme-preference";

describe("BSOD-359 theme preference storage", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("defaults to system when nothing is stored", () => {
    expect(readStoredThemePreference()).toBe("system");
  });

  it("defaults to system when the stored value is not a recognised preference", () => {
    localStorage.setItem(STORAGE_KEY, "blue");
    expect(readStoredThemePreference()).toBe("system");
  });

  it("round-trips a stored light/dark preference", () => {
    storeThemePreference("dark");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
    expect(readStoredThemePreference()).toBe("dark");

    storeThemePreference("light");
    expect(readStoredThemePreference()).toBe("light");
  });

  it("clears the storage key for system rather than writing the literal string", () => {
    storeThemePreference("dark");
    storeThemePreference("system");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(readStoredThemePreference()).toBe("system");
  });

  it("defaults to system when localStorage throws (private browsing, disabled storage)", () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new DOMException("denied");
      });
    expect(readStoredThemePreference()).toBe("system");
    getItemSpy.mockRestore();
  });

  it("does not throw when storing a preference is denied", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("denied");
      });

    expect(() => storeThemePreference("dark")).not.toThrow();
    expect(setItemSpy).toHaveBeenCalledWith(STORAGE_KEY, "dark");
  });

  it("does not throw when clearing a preference is denied", () => {
    localStorage.setItem(STORAGE_KEY, "dark");
    const removeItemSpy = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(() => {
        throw new DOMException("denied");
      });

    expect(() => storeThemePreference("system")).not.toThrow();
    expect(removeItemSpy).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it("stamps data-theme for an explicit light/dark preference", () => {
    applyThemePreference("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    applyThemePreference("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("clears data-theme for system, falling back to the prefers-color-scheme CSS", () => {
    applyThemePreference("dark");
    applyThemePreference("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
