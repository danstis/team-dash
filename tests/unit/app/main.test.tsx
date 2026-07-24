import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "../../../src/app/App";
import { db } from "../../../src/data/db/schema";
import { renderApp } from "../../../src/main";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

describe("T010 index.html (Vite entry document)", () => {
  const htmlPath = resolve(repoRoot, "index.html");
  const html = readFileSync(htmlPath, "utf8");

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
  afterEach(async () => {
    cleanup();
    await db.credentials.clear();
    await db.workspaces.clear();
  });

  it("renders without crashing", () => {
    expect(() => render(<App />)).not.toThrow();
  });

  it("renders the top-level product heading (T010 placeholder retained)", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { level: 1, name: /team dash/i }),
    ).toBeInTheDocument();
  });

  it("uses Australian English on the rendered main region", () => {
    const { container } = render(<App />);
    const main = container.querySelector("main");
    expect(main).not.toBeNull();
    expect(main?.getAttribute("lang")).toBe("en-AU");
  });

  it("explains that the credential entry screen is upcoming (T010 placeholder copy)", () => {
    render(<App />);
    expect(screen.getByText(/credential entry screen/i)).toBeInTheDocument();
  });
});

describe("T010 renderApp (bootstrap helper, T031 wires it to <App />)", () => {
  afterEach(async () => {
    cleanup();
    await db.credentials.clear();
    await db.workspaces.clear();
  });

  it("mounts <App /> into the provided container", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    act(() => {
      renderApp(container);
    });

    expect(container.querySelector("h1")?.textContent).toMatch(/team dash/i);
  });

  it("renders the shell under StrictMode (double-invoked for development safety)", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    act(() => {
      renderApp(container);
    });

    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });
});
