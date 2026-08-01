import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  reporter: [["html"], ["list"], ["github"]],
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
