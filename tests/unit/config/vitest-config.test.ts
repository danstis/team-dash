import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { asanaHandlers } from "../../../fixtures/asana/small-dataset/handlers";
import { server } from "../../setup";
import config from "../../../vitest.config";

describe("Vitest configuration", () => {
  it("uses jsdom and loads the shared test setup", () => {
    const setupFiles = config.test?.setupFiles;
    const configuredSetupFiles = Array.isArray(setupFiles)
      ? setupFiles
      : [setupFiles];

    expect(config.test?.environment).toBe("jsdom");
    expect(configuredSetupFiles).toContain("tests/setup.ts");
  });

  it("loads Testing Library matchers in the jsdom environment", () => {
    const element = document.createElement("button");
    element.textContent = "Test";
    document.body.append(element);

    expect(element).toBeInTheDocument();
    expect(element).toHaveTextContent("Test");
  });

  it("serves requests through the shared MSW server", async () => {
    const baselineHandlers = server.listHandlers().length;

    server.use(
      http.get("https://example.test/fixture", () =>
        HttpResponse.json({ ok: true }),
      ),
    );

    const response = await fetch("https://example.test/fixture");

    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(server.listHandlers()).toHaveLength(baselineHandlers + 1);
  });

  it("resets request handlers after each test back to the canonical fixture baseline", () => {
    expect(server.listHandlers()).toHaveLength(asanaHandlers.length);
  });
});
