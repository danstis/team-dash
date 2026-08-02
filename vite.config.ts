import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
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
    }),
  ],
});
