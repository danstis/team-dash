import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";

vi.mock("../../../src/app/credentials-context", () => ({
  CredentialsProvider: ({ children }: { children: ReactNode }) => children,
  useCredentials: () => ({
    state: "ready" as const,
    mode: "persistent" as const,
    maskedIdentifier: "abcd",
    setSessionToken: vi.fn(),
    setPersistentToken: vi.fn(),
    clearToSessionOnly: vi.fn(),
    clearAll: vi.fn(),
  }),
}));

vi.mock("../../../src/app/workspace-context", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    state: "ready" as const,
    workspace: {
      gid: "11111111-test-workspace",
      name: "Test Workspace",
      selectedAt: "2026-07-31T00:00:00.000Z",
    },
    selectWorkspace: vi.fn(),
    clearSelection: vi.fn(),
  }),
}));

import { App } from "../../../src/app/App";
import { renderApp } from "../../../src/main";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

describe("T010 index.html (Vite entry document)", () => {
  const htmlPath = resolve(repoRoot, "index.html");
  const html = readFileSync(htmlPath, "utf8");
  const expectedCsp =
    "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; img-src 'self' data:; connect-src 'self' https://app.asana.com; script-src 'self'; style-src 'self'";

  it("declares the document as Australian English (Constitution Principle VIII style rule)", () => {
    expect(html).toMatch(/<html\s+lang="en-AU"/);
  });

  it("declares a UTF-8 charset meta tag", () => {
    expect(html).toMatch(/<meta\s+charset="UTF-8"\s*\/?>/);
  });

  it("declares a responsive viewport meta tag", () => {
    expect(html).toMatch(
      /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1\.0"\s*\/?>/,
    );
  });

  it("declares the PWA theme-color meta tag matching the manifest", () => {
    expect(html).toMatch(
      /<meta\s+name="theme-color"\s+content="#0f172a"\s*\/?>/,
    );
  });

  it("declares installable app icon links", () => {
    expect(html).toMatch(
      /<link\s+rel="icon"\s+type="image\/png"\s+sizes="32x32"\s+href="\/icons\/team-dash-32\.png"\s*\/?>/,
    );
    expect(html).toMatch(
      /<link\s+rel="apple-touch-icon"\s+href="\/icons\/team-dash-180\.png"\s*\/?>/,
    );
  });

  it("declares a CSP meta fallback for static hosts that do not inject response headers", () => {
    expect(html).toMatch(/http-equiv="Content-Security-Policy"/);
    expect(html).toContain(expectedCsp);
  });

  it("sets the document title to the product name", () => {
    expect(html).toMatch(/<title>Team Dash<\/title>/);
  });

  it('mounts React into an element with id="root"', () => {
    expect(html).toMatch(/<div\s+id="root"\s*><\/div>/);
  });

  it("loads the application entry module /src/main.tsx as a module script", () => {
    expect(html).toMatch(
      /<script\s+type="module"\s+src="\/src\/main\.tsx"><\/script>/,
    );
  });
});

describe("T031 <App /> (T031 mounts the T010 placeholder content)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders without crashing", () => {
    expect(() => render(<App />)).not.toThrow();
  });

  it("renders the top-level product heading (T010 placeholder retained)", async () => {
    render(<App />);
    expect(
      await screen.findByRole("heading", { level: 1, name: /team dash/i }),
    ).toBeInTheDocument();
  });

  it("uses Australian English on the rendered main region", async () => {
    const { container } = render(<App />);
    const main = await screen.findByRole("main");
    expect(main).not.toBeNull();
    expect(main.getAttribute("lang")).toBe("en-AU");
    expect(container.querySelector("main")).not.toBeNull();
  });

  it("explains that the reporting dashboard is upcoming (T010 placeholder copy)", async () => {
    render(<App />);
    expect(await screen.findByText(/reporting dashboard/i)).toBeInTheDocument();
  });
});

describe("T010 renderApp (bootstrap helper, T031 wires it to <App />)", () => {
  afterEach(() => {
    cleanup();
  });

  it("mounts <App /> into the provided container", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      renderApp(container);
    });

    const heading = await waitFor(
      () => {
        const headings = container.querySelectorAll("h1");
        expect(headings).toHaveLength(1);

        const [found] = headings;
        if (found === undefined) {
          throw new Error("h1 not yet rendered");
        }
        expect(found.textContent).toMatch(/team dash/i);
        return found;
      },
      { timeout: 5000 },
    );
    expect(heading.textContent).toMatch(/team dash/i);
  });

  it("renders the shell under StrictMode (double-invoked for development safety)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      renderApp(container);
    });

    const heading = await waitFor(
      () => {
        const headings = container.querySelectorAll("h1");
        expect(headings).toHaveLength(1);

        const [found] = headings;
        if (found === undefined) {
          throw new Error("h1 not yet rendered");
        }
        expect(found.textContent).toMatch(/team dash/i);
        return found;
      },
      { timeout: 5000 },
    );
    expect(heading.textContent).toMatch(/team dash/i);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });
});

describe("T031 mountRootApp (BSOD-348 dev-server boot sequence)", () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    document.body.innerHTML = "";
  });

  it("runs bootstrapDevMocks then renderApp(rootElement) when VITE_USE_MOCKS=1 (BSOD-348, Sonar new-code coverage)", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_USE_MOCKS", "1");

    const startDevWorker = vi.fn().mockResolvedValue(undefined);
    vi.doMock("../../../src/mocks/browser", () => ({
      startDevWorker,
    }));

    const container = document.createElement("div");
    document.body.appendChild(container);

    const { mountRootApp } = await import("../../../src/main");

    await act(async () => {
      await mountRootApp(container);
    });

    // bootstrapDevMocks fired and consulted the worker (mocked).
    expect(startDevWorker).toHaveBeenCalledTimes(1);
    // renderApp fired and the App shell mounted into the container.
    await waitFor(
      () => {
        expect(container.querySelector("h1")).not.toBeNull();
      },
      { timeout: 5000 },
    );
    expect(container.querySelector("h1")?.textContent).toMatch(/team dash/i);
  });

  it("skips the MSW boot but still renders <App /> when VITE_USE_MOCKS is unset (BSOD-348, Sonar new-code coverage)", async () => {
    vi.stubEnv("DEV", true);
    // No VITE_USE_MOCKS stub: the new default-live path. The
    // env-var gate in bootstrapDevMocks short-circuits, so the
    // mocked worker is never consulted.
    const startDevWorker = vi.fn();
    vi.doMock("../../../src/mocks/browser", () => ({
      startDevWorker,
    }));

    const container = document.createElement("div");
    document.body.appendChild(container);

    const { mountRootApp } = await import("../../../src/main");

    await act(async () => {
      await mountRootApp(container);
    });

    expect(startDevWorker).not.toHaveBeenCalled();
    // renderApp still ran — the dev server's default-live path
    // must not block the app shell from mounting.
    await waitFor(
      () => {
        expect(container.querySelector("h1")).not.toBeNull();
      },
      { timeout: 5000 },
    );
    expect(container.querySelector("h1")?.textContent).toMatch(/team dash/i);
  });

  it("runs the top-level #root boot sequence when the script is loaded against an index.html-style document (BSOD-348, Sonar new-code coverage)", async () => {
    // Pin the env vars and the mocked worker BEFORE the dynamic
    // import so the dynamic-import inside bootstrapDevMocks picks
    // up the mocked module.
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_USE_MOCKS", "1");

    const startDevWorker = vi.fn().mockResolvedValue(undefined);
    vi.doMock("../../../src/mocks/browser", () => ({
      startDevWorker,
    }));

    // index.html declares <div id="root"></div> at module
    // evaluation time. Mirroring that here makes the module-top-
    // level `if (rootElement) { await mountRootApp(...) }` block
    // fire when src/main.tsx is dynamic-imported, which is the
    // line SonarCloud's new-code coverage was flagging.
    document.body.innerHTML = '<div id="root"></div>';

    // Force a fresh module evaluation so the top-level block runs
    // against the just-added #root, not the cached null from the
    // test file's earlier static import.
    vi.resetModules();
    await act(async () => {
      await import("../../../src/main");
    });

    const rootElement = document.getElementById("root");
    expect(rootElement).not.toBeNull();
    expect(startDevWorker).toHaveBeenCalledTimes(1);
    await waitFor(
      () => {
        expect(rootElement?.querySelector("h1")).not.toBeNull();
      },
      { timeout: 5000 },
    );
    expect(rootElement?.querySelector("h1")?.textContent).toMatch(/team dash/i);
  });

  it("does not call mountRootApp at the top level when the document has no #root element (BSOD-348)", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_USE_MOCKS", "1");

    const startDevWorker = vi.fn();
    vi.doMock("../../../src/mocks/browser", () => ({
      startDevWorker,
    }));

    // No #root in the document — the top-level guard must skip
    // mountRootApp entirely. (Production builds skip too via the
    // PROD guard, but a dev build against an unexpected document
    // should also no-op rather than throw.)
    document.body.innerHTML = "";

    vi.resetModules();
    await import("../../../src/main");

    expect(startDevWorker).not.toHaveBeenCalled();
  });
});
