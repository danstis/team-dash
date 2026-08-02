import { describe, expect, it, vi } from "vitest";

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
