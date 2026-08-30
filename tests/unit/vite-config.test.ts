import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { devMockServiceWorker } from "../../vite.config";

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

describe("Vite PWA configuration", () => {
  it("defines the Team Dash manifest without activating offline runtime caching", () => {
    expect(vitePwaMock).toHaveBeenCalledOnce();
    expect(vitePwaMock).toHaveBeenCalledWith({
      strategies: "generateSW",
      injectRegister: false,
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
        runtimeCaching: [],
      },
    });
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
