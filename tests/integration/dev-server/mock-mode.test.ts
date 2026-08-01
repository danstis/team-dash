/**
 * BSOD-348 — dev server default-to-live network calls.
 *
 * The MSW browser worker was originally wired into every `npm run dev`
 * run. That default hid real Asana errors from developers behind
 * silent fixture handlers (BSOD-347) and contradicted the
 * Constitution's local-first stance (Principle IV): with MSW off, the
 * dev server's network calls are the user's own browser → Asana
 * requests, so no token or data is proxied through the project.
 *
 * This test pins the new gating contract:
 *
 *   - `npm run dev` with no env var → the dev server boots and the
 *     browser's network calls reach `app.asana.com/api/1.0` directly.
 *     The MSW worker MUST NOT start, so the `[MSW] Mocking enabled.`
 *     console line never appears.
 *   - `VITE_USE_MOCKS=1 npm run dev` → the worker boots and the
 *     existing MSW handlers respond (the original T030 behaviour, now
 *     explicit opt-in).
 *   - `VITE_USE_MOCKS=0` (or any other value) → live, the same as
 *     unset. Only the literal string `"1"` opts in.
 *
 * Boundary
 * --------
 * The test relies on Vitest's `vi.stubEnv("VITE_USE_MOCKS", ...)` and
 * `vi.stubEnv("DEV", ...)` to mutate `import.meta.env` for the
 * duration of each case. `tests/setup.ts` boots the MSW Node server
 * (`src/mocks/server.ts`) for fixture-bound tests; this file
 * deliberately does not consult that surface because the gating
 * decision is made before the worker module is even loaded.
 *
 * `msw/browser` is replaced with a no-op `setupWorker` shim because
 * MSW's browser worker cannot register a Service Worker inside jsdom.
 * The shim keeps the `worker` export defined (so the module top-level
 * `setupWorker(...)` call evaluates) and stubs `worker.start` so the
 * env-var-disabled branch never reaches it. The real
 * `shouldStartDevMocks` predicate and `startDevWorker` PROD guard are
 * asserted by exercising them directly through the real
 * `src/mocks/browser` module — the top-level `vi.mock` of `msw/browser`
 * is what makes both possible without a real browser.
 */

vi.mock("msw/browser", () => ({
  setupWorker: () => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { afterEach, describe, expect, it, vi } from "vitest";

async function importMainModule() {
  return import("../../../src/main");
}

async function importMocksBrowser() {
  return import("../../../src/mocks/browser");
}

describe("BSOD-348 dev server default-to-live (VITE_USE_MOCKS env-var gate)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  describe("bootstrapDevMocks (src/main.tsx entry-point wiring)", () => {
    it("does not start the MSW worker when VITE_USE_MOCKS is unset in a development build", async () => {
      vi.stubEnv("DEV", true);
      // No VITE_USE_MOCKS stub: the dev server's default is live.

      const { bootstrapDevMocks } = await importMainModule();
      const { worker } = await importMocksBrowser();

      await bootstrapDevMocks();

      expect(worker.start).not.toHaveBeenCalled();
    });

    it("starts the MSW worker when VITE_USE_MOCKS=1 in a development build", async () => {
      vi.stubEnv("DEV", true);
      vi.stubEnv("VITE_USE_MOCKS", "1");

      const { bootstrapDevMocks } = await importMainModule();
      const { worker } = await importMocksBrowser();

      await bootstrapDevMocks();

      expect(worker.start).toHaveBeenCalledTimes(1);
    });

    it("does not start the MSW worker when VITE_USE_MOCKS is the literal string '0'", async () => {
      vi.stubEnv("DEV", true);
      vi.stubEnv("VITE_USE_MOCKS", "0");

      const { bootstrapDevMocks } = await importMainModule();
      const { worker } = await importMocksBrowser();

      await bootstrapDevMocks();

      // "0" is not the opt-in sentinel; the dev server stays live.
      expect(worker.start).not.toHaveBeenCalled();
    });

    it("does not start the MSW worker when VITE_USE_MOCKS is the literal string 'true'", async () => {
      vi.stubEnv("DEV", true);
      vi.stubEnv("VITE_USE_MOCKS", "true");

      const { bootstrapDevMocks } = await importMainModule();
      const { worker } = await importMocksBrowser();

      await bootstrapDevMocks();

      // Only the literal string "1" opts in; "true" is intentionally
      // not honoured so the gate is unambiguous in shell logs.
      expect(worker.start).not.toHaveBeenCalled();
    });

    it("does not start the MSW worker when VITE_USE_MOCKS is the empty string", async () => {
      vi.stubEnv("DEV", true);
      vi.stubEnv("VITE_USE_MOCKS", "");

      const { bootstrapDevMocks } = await importMainModule();
      const { worker } = await importMocksBrowser();

      await bootstrapDevMocks();

      expect(worker.start).not.toHaveBeenCalled();
    });

    it("does not start the MSW worker when not in a development build, even with VITE_USE_MOCKS=1", async () => {
      vi.stubEnv("DEV", false);
      vi.stubEnv("VITE_USE_MOCKS", "1");

      const { bootstrapDevMocks } = await importMainModule();
      const { worker } = await importMocksBrowser();

      await bootstrapDevMocks();

      // Production builds short-circuit before the env-var check; the
      // existing PROD guard in startDevWorker would also throw on a
      // direct call. The entry-point contract is the first line of
      // defence and is what this assertion pins.
      expect(worker.start).not.toHaveBeenCalled();
    });
  });

  describe("shouldStartDevMocks predicate (src/mocks/browser.ts)", () => {
    it("returns false in a development build when VITE_USE_MOCKS is unset", async () => {
      vi.stubEnv("DEV", true);

      const { shouldStartDevMocks } = await importMocksBrowser();
      expect(shouldStartDevMocks()).toBe(false);
    });

    it("returns true in a development build when VITE_USE_MOCKS is the literal string '1'", async () => {
      vi.stubEnv("DEV", true);
      vi.stubEnv("VITE_USE_MOCKS", "1");

      const { shouldStartDevMocks } = await importMocksBrowser();
      expect(shouldStartDevMocks()).toBe(true);
    });

    it("returns false for any non-'1' value, including '0', 'true', 'yes', and the empty string", async () => {
      vi.stubEnv("DEV", true);

      const { shouldStartDevMocks } = await importMocksBrowser();

      for (const value of ["0", "true", "yes", "", "TRUE", "1 "]) {
        vi.stubEnv("VITE_USE_MOCKS", value);
        expect(shouldStartDevMocks()).toBe(false);
        vi.unstubAllEnvs();
        vi.stubEnv("DEV", true);
      }
    });

    it("returns false in a production build regardless of VITE_USE_MOCKS", async () => {
      vi.stubEnv("DEV", false);
      vi.stubEnv("PROD", true);
      vi.stubEnv("VITE_USE_MOCKS", "1");

      const { shouldStartDevMocks } = await importMocksBrowser();
      expect(shouldStartDevMocks()).toBe(false);
    });
  });

  describe("startDevWorker defence-in-depth guard (src/mocks/browser.ts)", () => {
    it("resolves to undefined without booting the worker when VITE_USE_MOCKS is unset", async () => {
      vi.stubEnv("DEV", true);

      const { startDevWorker, worker } = await importMocksBrowser();
      // The env-var gate short-circuits before the worker is touched,
      // so `worker.start` is never called even though `startDevWorker`
      // returned successfully.
      await expect(startDevWorker()).resolves.toBeUndefined();
      expect(worker.start).not.toHaveBeenCalled();
    });

    it("resolves to undefined without booting the worker when VITE_USE_MOCKS is not the opt-in sentinel", async () => {
      vi.stubEnv("DEV", true);
      vi.stubEnv("VITE_USE_MOCKS", "false");

      const { startDevWorker, worker } = await importMocksBrowser();
      await expect(startDevWorker()).resolves.toBeUndefined();
      expect(worker.start).not.toHaveBeenCalled();
    });

    it("still throws in a production build even when VITE_USE_MOCKS=1", async () => {
      vi.stubEnv("DEV", false);
      vi.stubEnv("PROD", true);
      vi.stubEnv("VITE_USE_MOCKS", "1");

      const { startDevWorker } = await importMocksBrowser();
      // The original T030 production guard must remain intact — a
      // future contributor who removes it would silently ship MSW to
      // users, which is a Constitution Principle IV violation. The
      // env-var gate sits below the PROD guard precisely so a
      // regression in the PROD guard is caught here.
      await expect(startDevWorker()).rejects.toThrow(
        /MSW dev worker must not be started in a production build/,
      );
    });
  });

  describe("observability: the [MSW] Mocking enabled. console line", () => {
    it("is never emitted when VITE_USE_MOCKS is unset (no Service Worker registration runs)", async () => {
      vi.stubEnv("DEV", true);

      // The MSW `setupWorker(...).start()` call is what prints
      // `[MSW] Mocking enabled.` to the browser console. With the
      // env-var gate in place the bootstrap path never reaches that
      // call, so the console must be silent for MSW boot messages.
      // (Other console output from the rest of the app is out of
      // scope — the assertion checks only the absence of the MSW
      // boot line.)
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      const { bootstrapDevMocks } = await importMainModule();
      const { worker } = await importMocksBrowser();

      await bootstrapDevMocks();

      expect(worker.start).not.toHaveBeenCalled();
      const mswMessages = consoleLogSpy.mock.calls.filter((args) =>
        args.some((arg) => typeof arg === "string" && /\[MSW\]/i.test(arg)),
      );
      expect(mswMessages).toHaveLength(0);

      consoleLogSpy.mockRestore();
    });

    it("does start the worker when VITE_USE_MOCKS=1 is set, matching the original T030 behaviour", async () => {
      vi.stubEnv("DEV", true);
      vi.stubEnv("VITE_USE_MOCKS", "1");

      const { bootstrapDevMocks } = await importMainModule();
      const { worker } = await importMocksBrowser();

      await bootstrapDevMocks();

      // The mock worker.start is invoked, which is what would print
      // the `[MSW] Mocking enabled.` line in a real browser. The
      // bootstrap path correctly hands off control in the opt-in case.
      expect(worker.start).toHaveBeenCalledTimes(1);
    });
  });
});
