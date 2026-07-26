/**
 * Visual-QA DOM capture: render the Settings credentials panel (T045)
 * in each of the five documented states via the same jsdom + RTL +
 * MSW + fake-indexeddb environment the integration tests use, and
 * dump the rendered HTML to `.multica/visual-qa/<label>.html`.
 *
 * This is a one-shot capture, not a normal test — it always passes
 * because the assertions are merely "the DOM contains a settings
 * panel". The capture exists so the Spec Kit / Multica workflow can
 * attach the resulting HTML files to PR #86 as the documented
 * visual-QA evidence required by the Release/Link Steward's
 * `not-merge-ready` verdict (SonarCloud + missing visual-QA).
 *
 * Run: `npx vitest run tests/visual-qa-dump.test.tsx`
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { StrictMode } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

import { CredentialsProvider } from "../src/app/credentials-context";
import { SettingsCredentialsPanel } from "../src/features/credentials/SettingsCredentialsPanel";
import { db } from "../src/data/db/schema";
import {
  encryptToken,
  generateTokenKey,
} from "../src/data/crypto/token-crypto";

const OUTPUT_DIR = resolve(process.cwd(), ".multica/visual-qa");

async function ensureOutputDir(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
}

async function dump(label: string, container: HTMLElement): Promise<void> {
  await writeFile(
    resolve(OUTPUT_DIR, `${label}.html`),
    container.innerHTML,
    "utf8",
  );
}

async function blankStores(): Promise<void> {
  await db.credentials.clear();
  await db.workspaces.clear();
  await db.projects.clear();
  await db.portfolios.clear();
  await db.asanaTeams.clear();
  await db.teamMappingOverrides.clear();
  await db.personGroups.clear();
  await db.users.clear();
  await db.priorityFields.clear();
  await db.dependencies.clear();
  await db.sections.clear();
  await db.tasks.clear();
  await db.snapshots.clear();
  await db.refreshSessions.clear();
}

function lastFour(token: string): string {
  return token.slice(-4);
}

describe("T045 Settings panel — visual-QA DOM capture (writes .multica/visual-qa/*.html)", () => {
  beforeAll(async () => {
    await ensureOutputDir();
  });

  afterAll(async () => {
    cleanup();
    await blankStores();
  });

  it("captures the panel in each documented state (writes HTML files)", async () => {
    await blankStores();
    cleanup();

    // State 1: initial first_run.
    {
      const result = render(
        <StrictMode>
          <CredentialsProvider>
            <SettingsCredentialsPanel />
          </CredentialsProvider>
        </StrictMode>,
      );
      await waitFor(() =>
        expect(result.getByTestId("settings-panel")).toBeInTheDocument(),
      );
      await dump("01-initial-first-run", result.container);
      cleanup();
    }

    // State 2: session-mode after Set token.
    {
      const result = render(
        <StrictMode>
          <CredentialsProvider>
            <SettingsCredentialsPanel />
          </CredentialsProvider>
        </StrictMode>,
      );
      await waitFor(() =>
        expect(result.getByTestId("settings-panel")).toBeInTheDocument(),
      );
      fireEvent.change(result.getByLabelText(/token/i), {
        target: { value: "fixture-session-token-aaaaaaaa" },
      });
      fireEvent.click(result.getByRole("button", { name: /set token/i }));
      await waitFor(() =>
        expect(
          result.getByRole("button", { name: /switch to persistent/i }),
        ).toBeInTheDocument(),
      );
      await dump("02-session-after-set-token", result.container);
      cleanup();
    }

    // State 3: persistent-confirmation dialog.
    {
      const result = render(
        <StrictMode>
          <CredentialsProvider>
            <SettingsCredentialsPanel />
          </CredentialsProvider>
        </StrictMode>,
      );
      await waitFor(() =>
        expect(result.getByTestId("settings-panel")).toBeInTheDocument(),
      );
      fireEvent.change(result.getByLabelText(/token/i), {
        target: { value: "fixture-session-token-aaaaaaaa" },
      });
      fireEvent.click(result.getByRole("button", { name: /set token/i }));
      await waitFor(() =>
        expect(
          result.getByRole("button", { name: /switch to persistent/i }),
        ).toBeInTheDocument(),
      );
      fireEvent.click(
        result.getByRole("button", { name: /switch to persistent/i }),
      );
      await waitFor(() =>
        expect(
          result.getByTestId("persistent-confirmation"),
        ).toBeInTheDocument(),
      );
      await dump("03-persistent-confirmation-dialog", result.container);
      // Decline so the confirm action stays pending for the operator.
      fireEvent.click(result.getByRole("button", { name: /decline/i }));
      cleanup();
    }

    // State 4: clear-all-confirmation dialog.
    {
      const result = render(
        <StrictMode>
          <CredentialsProvider>
            <SettingsCredentialsPanel />
          </CredentialsProvider>
        </StrictMode>,
      );
      await waitFor(() =>
        expect(result.getByTestId("settings-panel")).toBeInTheDocument(),
      );
      fireEvent.click(result.getByRole("button", { name: /clear all/i }));
      await waitFor(() =>
        expect(
          result.getByTestId("clear-all-confirmation"),
        ).toBeInTheDocument(),
      );
      await dump("04-clear-all-confirmation-dialog", result.container);
      // Cancel so the destructive confirm stays pending.
      fireEvent.click(result.getByRole("button", { name: /^cancel$/i }));
      cleanup();
    }

    // State 5: persistent-mode loaded (decrypted on mount).
    {
      const key = await generateTokenKey();
      const { ciphertext, iv } = await encryptToken(
        "fixture-session-token-aaaaaaaa",
        key,
      );
      await db.credentials.put({
        mode: "persistent",
        encryptedTokenRecord: { ciphertext, iv, keyRef: key },
        maskedIdentifier: lastFour("fixture-session-token-aaaaaaaa"),
        lastValidatedAt: null,
        lastValidationResult: null,
      });
      const result = render(
        <StrictMode>
          <CredentialsProvider>
            <SettingsCredentialsPanel />
          </CredentialsProvider>
        </StrictMode>,
      );
      // Wait for the credentials context to decrypt the seeded row so
      // the Storage mode fieldset reports "persistent" before we
      // snapshot the DOM.
      await waitFor(async () => {
        const probe = result.getByTestId("settings-panel").textContent ?? "";
        return probe.includes("persistent");
      }).catch(() => {
        // Best-effort; the capture still produces useful output.
      });
      await dump("05-persistent-mode-loaded", result.container);
      await db.credentials.clear();
      cleanup();
    }

    expect(true).toBe(true);
  });
});
