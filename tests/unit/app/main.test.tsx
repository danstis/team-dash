import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "../../../src/app/App";
import { db } from "../../../src/data/db/schema";
import {
  encryptToken,
  generateTokenKey,
} from "../../../src/data/crypto/token-crypto";
import { renderApp } from "../../../src/main";

/**
 * Seed IndexedDB so the T046 route guard (BSOD-174) reports the
 * `'ready'` state for both `CredentialsProvider` and
 * `WorkspaceProvider`. The shell tests below exercise the gate-open
 * reporting surface (the `<h1>Team Dash</h1>` T010 placeholder),
 * which the route guard only renders when both contexts are
 * `'ready'`.
 */
async function seedReadyGateState(): Promise<void> {
  const token = "t010-shell-test-token-abcd";
  const key = await generateTokenKey();
  const { ciphertext, iv } = await encryptToken(token, key);
  await db.credentials.put({
    mode: "persistent",
    encryptedTokenRecord: { ciphertext, iv, keyRef: key },
    maskedIdentifier: "abcd",
    lastValidatedAt: null,
    lastValidationResult: null,
  });
  await db.workspaces.put({
    gid: "11111111-test-workspace",
    name: "Test Workspace",
    selectedAt: "2026-07-31T00:00:00.000Z",
  });
}

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
  afterEach(async () => {
    cleanup();
    await db.credentials.clear();
    await db.workspaces.clear();
  });

  it("renders without crashing", () => {
    expect(() => render(<App />)).not.toThrow();
  });

  it("renders the top-level product heading (T010 placeholder retained)", async () => {
    // T046 (BSOD-174) wires the route guard that hides the T010
    // placeholder while either provider reports anything other than
    // `'ready'`. The placeholder is the gate-open reporting surface;
    // seed the gate-open state so the test continues to verify the
    // heading contract.
    await seedReadyGateState();
    render(<App />);
    expect(
      await screen.findByRole("heading", { level: 1, name: /team dash/i }),
    ).toBeInTheDocument();
  });

  it("uses Australian English on the rendered main region", async () => {
    await seedReadyGateState();
    const { container } = render(<App />);
    const main = await screen.findByRole("main");
    expect(main).not.toBeNull();
    expect(main.getAttribute("lang")).toBe("en-AU");
    expect(container.querySelector("main")).not.toBeNull();
  });

  it("explains that the credential entry screen is upcoming (T010 placeholder copy)", async () => {
    await seedReadyGateState();
    render(<App />);
    expect(
      await screen.findByText(/credential entry screen/i),
    ).toBeInTheDocument();
  });
});

describe("T010 renderApp (bootstrap helper, T031 wires it to <App />)", () => {
  afterEach(async () => {
    cleanup();
    await db.credentials.clear();
    await db.workspaces.clear();
  });

  it("mounts <App /> into the provided container", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    await seedReadyGateState();

    await act(async () => {
      renderApp(container);
    });

    const heading = await waitFor(
      () => {
        const found = container.querySelector("h1");
        if (found === null) {
          throw new Error("h1 not yet rendered");
        }
        return found;
      },
      { timeout: 5000 },
    );
    expect(heading.textContent).toMatch(/team dash/i);
  });

  it("renders the shell under StrictMode (double-invoked for development safety)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    await seedReadyGateState();

    await act(async () => {
      renderApp(container);
    });

    const heading = await waitFor(
      () => {
        const found = container.querySelector("h1");
        if (found === null) {
          throw new Error("h1 not yet rendered");
        }
        return found;
      },
      { timeout: 5000 },
    );
    expect(heading.textContent).toMatch(/team dash/i);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });
});
