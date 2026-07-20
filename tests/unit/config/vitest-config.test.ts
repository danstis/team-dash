import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import config from "../../../vitest.config";
import { server } from "../../setup";

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
    server.use(
      http.get("https://example.test/fixture", () =>
        HttpResponse.json({ ok: true }),
      ),
    );

    const response = await fetch("https://example.test/fixture");

    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(server.listHandlers()).toHaveLength(1);
  });

  it("resets request handlers after each test", () => {
    expect(server.listHandlers()).toHaveLength(0);
  });
});
