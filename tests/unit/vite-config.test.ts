import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { devMockServiceWorker } from "../../vite.config";
import {
  SERVICE_WORKER_CACHE_HEADER,
  SERVICE_WORKER_CACHE_HEADER_VALUE,
} from "../../src/shared/service-worker-cache";

const { vitePwaMock } = vi.hoisted(() => ({
  vitePwaMock: vi.fn((options: unknown) => ({
    name: "vite-plugin-pwa",
    options,
  })),
}));

vi.mock("vite-plugin-pwa", () => ({
  VitePWA: vitePwaMock,
}));

await import("../../vite.config");

// vite.config calls VitePWA once while it loads, before any test runs.
// Vitest 5 clears mock call history before each test (clearMocks now
// defaults to true), so capture the call here rather than reading
// vitePwaMock.mock.calls inside the tests.
const vitePwaCalls = [...vitePwaMock.mock.calls];

/**
 * The options the PWA plugin is configured with, as the shape the
 * assertions below read them. The object is built once so the
 * "verbatim options" assertion and the focused assertions below
 * cannot drift apart.
 */
function pwaOptions(): Record<string, unknown> {
  return {
    strategies: "generateSW",
    injectRegister: false,
    registerType: "autoUpdate",
    manifest: {
      name: "Team Dash",
      short_name: "Team Dash",
      description:
        "A local-first Asana team performance and workload dashboard.",
      lang: "en-AU",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#0f172a",
      icons: [
        {
          src: "/icons/team-dash-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any maskable",
        },
        {
          src: "/icons/team-dash-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any maskable",
        },
      ],
    },
    workbox: {
      globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest,woff2}"],
      navigateFallback: "/index.html",
      cleanupOutdatedCaches: true,
      skipWaiting: true,
      clientsClaim: true,
      runtimeCaching: [asanaApiRuntimeCaching()],
    },
  };
}

/**
 * The runtime-caching entry the Asana API responses are stored under.
 *
 * The plugin's `cachedResponseWillBeUsed` hook is a FUNCTION, so the
 * "verbatim options" assertion compares it by type. The hook is
 * exercised directly by the marker test below, which is what pins
 * the header the hook writes.
 */
function asanaApiRuntimeCaching(): Record<string, unknown> {
  return {
    urlPattern: /^https:\/\/app\.asana\.com\/api\/1\.0\/.*/,
    handler: "NetworkFirst",
    options: {
      cacheName: "team-dash-asana-api",
      cacheableResponse: { statuses: [0, 200] },
      expiration: {
        maxEntries: 200,
        maxAgeSeconds: 60 * 60 * 24 * 7,
      },
      plugins: [
        {
          // The hook is a function, so the verbatim assertion compares
          // it by type; the marker test below invokes the real hook
          // and pins what it writes.
          cachedResponseWillBeUsed: expect.any(Function),
        },
      ],
    },
  };
}

describe("Vite PWA configuration", () => {
  it("defines the Team Dash manifest and the offline caching strategy", () => {
    expect(vitePwaCalls).toHaveLength(1);
    expect(vitePwaCalls[0]).toEqual([pwaOptions()]);
  });

  it("precaches the app shell so the app boots with no network", () => {
    const options = vitePwaCalls[0]?.[0] as {
      workbox: { globPatterns: string[]; navigateFallback: string };
    };
    // The entry document, the hashed build assets, the manifest, the
    // PWA icons and the bundled fonts are all part of the app shell.
    expect(options.workbox.globPatterns).toEqual([
      "**/*.{js,css,html,ico,png,svg,webmanifest,woff2}",
    ]);
    // Every navigation is answered with the precached entry document,
    // so a reload with no network still boots the SPA.
    expect(options.workbox.navigateFallback).toBe("/index.html");
  });

  it("takes control of the open page as soon as the worker activates", () => {
    const options = vitePwaCalls[0]?.[0] as {
      registerType: string;
      workbox: { skipWaiting: boolean; clientsClaim: boolean };
    };
    expect(options.registerType).toBe("autoUpdate");
    expect(options.workbox.skipWaiting).toBe(true);
    expect(options.workbox.clientsClaim).toBe(true);
  });

  it("keeps the last complete Asana responses for the offline surface", () => {
    const options = vitePwaCalls[0]?.[0] as {
      workbox: {
        runtimeCaching: {
          urlPattern: RegExp;
          handler: string;
          options: { cacheName: string };
        }[];
      };
    };
    const entry = options.workbox.runtimeCaching[0];
    expect(entry?.handler).toBe("NetworkFirst");
    expect(entry?.options.cacheName).toBe("team-dash-asana-api");
    // The entry only covers the read-only Asana API surface — the
    // read-only guarantee (FR-009 / NFR-004) must not be widened by
    // the offline layer.
    expect(
      entry?.urlPattern.test("https://app.asana.com/api/1.0/projects"),
    ).toBe(true);
    expect(
      entry?.urlPattern.test("https://app.asana.com/api/1.0/tasks/1"),
    ).toBe(true);
    expect(entry?.urlPattern.test("https://example.com/api/1.0/projects")).toBe(
      false,
    );
  });

  it("marks a service-worker-cached response with the shared header", async () => {
    const options = vitePwaCalls[0]?.[0] as {
      workbox: {
        runtimeCaching: {
          options: {
            plugins: {
              cachedResponseWillBeUsed: (param: {
                cachedResponse?: Response;
              }) => Promise<Response | undefined>;
            }[];
          };
        }[];
      };
    };
    const hook =
      options.workbox.runtimeCaching[0]?.options.plugins[0]
        ?.cachedResponseWillBeUsed;
    expect(typeof hook).toBe("function");

    const cached = new Response("{}", { status: 200 });
    const markedPromise = hook?.({ cachedResponse: cached });
    expect(markedPromise).toBeInstanceOf(Promise);
    const marked = await markedPromise;
    // The app's Asana client refuses a response that carries this
    // header (FR-022: a refresh may only ever commit live data), so
    // the header the worker writes and the header the client reads
    // have to be the same one.
    expect(marked?.headers.get(SERVICE_WORKER_CACHE_HEADER)).toBe(
      SERVICE_WORKER_CACHE_HEADER_VALUE,
    );
    expect(await marked?.text()).toBe("{}");

    const missingResponsePromise = hook?.({});
    expect(missingResponsePromise).toBeInstanceOf(Promise);
    expect(await missingResponsePromise).toBeUndefined();
  });
});

describe("devMockServiceWorker dev-only middleware", () => {
  const workerScript = readFileSync(
    join(process.cwd(), "dev", "mockServiceWorker.js"),
  );

  interface FakeRes {
    setHeader: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  }

  function wireMiddleware() {
    const plugin = devMockServiceWorker();
    let handler: (req: unknown, res: unknown, next: unknown) => void = () => {};
    const server = {
      config: { root: process.cwd() },
      middlewares: {
        use: (fn: typeof handler) => {
          handler = fn;
        },
      },
    };
    const configureServer = plugin.configureServer;
    const hook = (
      typeof configureServer === "function"
        ? configureServer
        : configureServer?.handler
    ) as ((server: unknown) => void) | undefined;
    hook?.(server);
    return handler;
  }

  function invoke(url: string) {
    const res: FakeRes = { setHeader: vi.fn(), end: vi.fn() };
    const next = vi.fn();
    wireMiddleware()({ url }, res, next);
    return { res, next };
  }

  it("applies only during `vite serve`", () => {
    const plugin = devMockServiceWorker();
    expect(plugin.apply).toBe("serve");
    expect(plugin.name).toBe("team-dash:dev-mock-service-worker");
  });

  it("serves the MSW worker script at /mockServiceWorker.js with worker headers", () => {
    const { res, next } = invoke("/mockServiceWorker.js");
    expect(next).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/javascript; charset=utf-8",
    );
    expect(res.setHeader).toHaveBeenCalledWith("Service-Worker-Allowed", "/");
    expect(res.end).toHaveBeenCalledOnce();
    const body = res.end.mock.calls[0][0] as Buffer;
    expect(Buffer.compare(body, workerScript)).toBe(0);
  });

  it("ignores a query string on the worker request", () => {
    const { res, next } = invoke("/mockServiceWorker.js?worker");
    expect(next).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledOnce();
  });

  it("passes every other request through untouched", () => {
    const { res, next } = invoke("/index.html");
    expect(next).toHaveBeenCalledOnce();
    expect(res.end).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});
