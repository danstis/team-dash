import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderApp, TeamDashShell } from "../../../src/main";

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

describe("T010 TeamDashShell (Phase 1 placeholder)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders without crashing", () => {
    expect(() => render(<TeamDashShell />)).not.toThrow();
  });

  it("renders a top-level heading announcing the product", () => {
    render(<TeamDashShell />);
    expect(
      screen.getByRole("heading", { level: 1, name: /team dash/i }),
    ).toBeInTheDocument();
  });

  it("uses Australian English on the rendered main region", () => {
    const { container } = render(<TeamDashShell />);
    const main = container.querySelector("main");
    expect(main).not.toBeNull();
    expect(main?.getAttribute("lang")).toBe("en-AU");
  });

  it("explains that the application is bootstrapping and credential entry is upcoming", () => {
    render(<TeamDashShell />);
    expect(screen.getByText(/credential entry screen/i)).toBeInTheDocument();
  });
});

describe("T010 renderApp (bootstrap helper)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts TeamDashShell into the provided container", () => {
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
