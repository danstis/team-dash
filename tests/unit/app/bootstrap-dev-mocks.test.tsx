import { afterEach, describe, expect, it, vi } from "vitest";

async function importMainModule() {
  return import("../../../src/main");
}

describe("T030 bootstrapDevMocks", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("starts the MSW browser worker in development when VITE_USE_MOCKS=1 (BSOD-348)", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_USE_MOCKS", "1");

    const startDevWorker = vi.fn().mockResolvedValue(undefined);
    vi.doMock("../../../src/mocks/browser", () => ({
      startDevWorker,
    }));

    const { bootstrapDevMocks } = await importMainModule();

    await bootstrapDevMocks();

    expect(startDevWorker).toHaveBeenCalledTimes(1);
  });

  it("returns early outside development builds", async () => {
    vi.stubEnv("DEV", false);

    const startDevWorker = vi.fn();
    vi.doMock("../../../src/mocks/browser", () => ({
      startDevWorker,
    }));

    const { bootstrapDevMocks } = await importMainModule();

    await bootstrapDevMocks();

    expect(startDevWorker).not.toHaveBeenCalled();
  });

  it("warns and falls back to the live network when the worker fails to start", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_USE_MOCKS", "1");

    const failure = new Error("service worker registration failed");
    const startDevWorker = vi.fn().mockRejectedValue(failure);
    vi.doMock("../../../src/mocks/browser", () => ({
      startDevWorker,
    }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { bootstrapDevMocks } = await importMainModule();

    await expect(bootstrapDevMocks()).resolves.toBeUndefined();

    expect(startDevWorker).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("MSW dev worker failed to start"),
      failure,
    );
  });
});
