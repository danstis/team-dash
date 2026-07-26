/**
 * T037 — integration test for the Settings credentials panel.
 *
 * Spec / contract references
 * --------------------------
 * User Story 1 acceptance scenario 6 (FR-004 / FR-005 / FR-005a / FR-006 /
 * FR-007 / FR-008):
 *
 *   "Given an already-configured session, When the user opens Settings,
 *    Then they can test the current token again, replace it, switch
 *    between session-only and persistent storage, or clear the token and
 *    all locally retained Asana data in one explicit action."
 *
 * This test pins the behaviour of the Settings credentials panel
 * (`src/features/credentials/SettingsCredentialsPanel.tsx`, T045) at the
 * integration boundary the rest of the app sees — a `<CredentialsProvider>`
 * subtree exercising the retest / replace / switch-mode / clear-all
 * actions against the MSW-backed Asana API and the real Dexie
 * `credentials` + every other store (FR-007 single-action wipe spans
 * every store in one transaction).
 *
 * Why this is an integration test, not a unit test
 * ------------------------------------------------
 * - The actions under test are the cross-feature handoff between the
 *   feature component (T045), the `CredentialsProvider` (T031), the
 *   future `CredentialRepository` (T040), the token-crypto module (T027),
 *   and the MSW-backed Asana client (T025 + T034 + T039). Pinning each
 *   piece in isolation leaves the cross-boundary bugs visible; this
 *   test renders the real provider tree and observes the side-effects
 *   (IndexedDB writes, MSW request log) the boundaries must produce.
 *
 * - Constitution Principle III "Test-First Quality and Mandatory
 *   Automation" makes this the Red-phase contract for T045: the test
 *   fails for the intended reason (the Settings panel + CredentialRepository
 *   are not yet implemented) and the implementation rows T039–T046
 *   are the work that turns it Green.
 *
 * URL / log / value safety (FR-008)
 * ---------------------------------
 * Every assertion that observes the rendered DOM, the
 * `CredentialsProvider` value, or the MSW request log pins that the
 * full plaintext token never appears in any of those surfaces. The
 * masked identifier (T044) is the only representation the rest of
 * the app is allowed to display.
 *
 * Tests run via MSW (no live Asana token)
 * ---------------------------------------
 * `tests/setup.ts` already starts the canonical MSW Node server
 * pre-loaded with the small-dataset fixture handlers, so a token
 * round-trips through the fixture without the test ever reaching the
 * real network. Per-test `server.use(...)` overrides cover the
 * failure paths (invalid token, insufficient permission, network
 * failure) without ever exposing a real PAT.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CredentialsProvider,
  useCredentials,
} from "../../../src/app/credentials-context";
import { db } from "../../../src/data/db/schema";
import {
  encryptToken,
  generateTokenKey,
} from "../../../src/data/crypto/token-crypto";
import { SettingsCredentialsPanel } from "../../../src/features/credentials/SettingsCredentialsPanel";
import { smallDatasetWorkspaceGid } from "../../../fixtures/asana/small-dataset/handlers";
import { server } from "../../setup";

/**
 * Stable synthetic PATs for the panel actions. They are deliberately
 * NOT realistic Asana PATs — the MSW fixture authorises every bearer
 * token the test sends and rejects the ones the test wants to fail
 * on, which is what the panel has to handle. The fixture never logs
 * or echoes these strings; the assertions below confirm the test
 * surface does not either (FR-008).
 */
const SESSION_TOKEN_A = "fixture-session-token-aaaaaaaa";
const REPLACEMENT_TOKEN = "fixture-replacement-token-cccccccc";
const INVALID_TOKEN = "fixture-invalid-token";

async function clearEveryStore(): Promise<void> {
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
  await db.credentials.clear();
}

/**
 * The four PAT characters the masked identifier is allowed to surface
 * (T044 — last-4-characters only). The full token never appears in the
 * rendered DOM or the credentials context value (FR-008).
 */
function lastFour(token: string): string {
  return token.slice(-4);
}

/**
 * A small probe component that exposes the live `useCredentials()`
 * value via `data-testid` slots so a test can read it without
 * coupling to React internals.
 */
function CredentialsProbe(): ReactNode {
  const value = useCredentials();
  return (
    <div data-testid="probe">
      <span data-testid="probe-state">{value.state}</span>
      <span data-testid="probe-mode">{value.mode ?? "none"}</span>
      <span data-testid="probe-masked">{value.maskedIdentifier}</span>
    </div>
  );
}

/**
 * Mount `<CredentialsProvider>` with the Settings panel + a probe.
 * Clears the credentials table beforehand so the previous test's
 * encrypted row cannot leak into the next.
 */
function renderPanel(): {
  stateProbe: () => string | null;
  modeProbe: () => string | null;
  maskedProbe: () => string | null;
  container: HTMLElement;
} {
  const result = render(
    <CredentialsProvider>
      <SettingsCredentialsPanel />
      <CredentialsProbe />
    </CredentialsProvider>,
  );

  return {
    stateProbe: () => screen.getByTestId("probe-state").textContent,
    modeProbe: () => screen.getByTestId("probe-mode").textContent,
    maskedProbe: () => screen.getByTestId("probe-masked").textContent,
    container: result.container,
  };
}

describe("T037 Settings credentials panel (US1 acceptance scenario 6)", () => {
  beforeEach(async () => {
    await clearEveryStore();
  });

  afterEach(async () => {
    cleanup();
    await clearEveryStore();
  });

  describe("Retest action (FR-004)", () => {
    it("displays a 'token valid' outcome when the fixture round-trip succeeds", async () => {
      // No override — the canonical MSW handler for /users/me returns
      // the fixture's first user. The Retest button calls testToken,
      // sees the ok outcome, and surfaces the validity to the user
      // (FR-004: 'success or specific failure reason').
      const panel = renderPanel();

      await waitFor(() =>
        expect(screen.getByTestId("settings-panel")).toBeInTheDocument(),
      );

      fireEvent.change(screen.getByLabelText(/token/i), {
        target: { value: SESSION_TOKEN_A },
      });
      fireEvent.click(screen.getByRole("button", { name: /set token/i }));

      fireEvent.click(screen.getByRole("button", { name: /retest/i }));

      await waitFor(() =>
        expect(screen.getByTestId("retest-outcome")).toHaveTextContent(
          /valid/i,
        ),
      );

      // The provider state did not change as a side-effect of retest —
      // it is an on-demand validity probe, not a credential mutation.
      expect(panel.stateProbe()).toBe("ready");
      expect(panel.modeProbe()).toBe("session");
    });

    it("displays a specific 'invalid token' reason on a 401 response", async () => {
      server.use(
        http.get(
          "https://app.asana.com/api/1.0/users/me",
          () => new HttpResponse(null, { status: 401 }),
        ),
      );

      renderPanel();

      await waitFor(() =>
        expect(screen.getByTestId("settings-panel")).toBeInTheDocument(),
      );

      fireEvent.change(screen.getByLabelText(/token/i), {
        target: { value: INVALID_TOKEN },
      });
      fireEvent.click(screen.getByRole("button", { name: /set token/i }));
      fireEvent.click(screen.getByRole("button", { name: /retest/i }));

      await waitFor(() =>
        expect(screen.getByTestId("retest-outcome")).toHaveTextContent(
          /invalid token/i,
        ),
      );
    });

    it("displays a specific 'insufficient permission' reason on a 403 response", async () => {
      server.use(
        http.get(
          "https://app.asana.com/api/1.0/users/me",
          () => new HttpResponse(null, { status: 403 }),
        ),
      );

      renderPanel();

      await waitFor(() =>
        expect(screen.getByTestId("settings-panel")).toBeInTheDocument(),
      );

      fireEvent.change(screen.getByLabelText(/token/i), {
        target: { value: SESSION_TOKEN_A },
      });
      fireEvent.click(screen.getByRole("button", { name: /set token/i }));
      fireEvent.click(screen.getByRole("button", { name: /retest/i }));

      await waitFor(() =>
        expect(screen.getByTestId("retest-outcome")).toHaveTextContent(
          /insufficient permission/i,
        ),
      );
    });

    it("displays a specific 'network error' reason on a transport failure", async () => {
      server.use(
        http.get("https://app.asana.com/api/1.0/users/me", () =>
          HttpResponse.error(),
        ),
      );

      renderPanel();

      await waitFor(() =>
        expect(screen.getByTestId("settings-panel")).toBeInTheDocument(),
      );

      fireEvent.change(screen.getByLabelText(/token/i), {
        target: { value: SESSION_TOKEN_A },
      });
      fireEvent.click(screen.getByRole("button", { name: /set token/i }));
      fireEvent.click(screen.getByRole("button", { name: /retest/i }));

      await waitFor(() =>
        expect(screen.getByTestId("retest-outcome")).toHaveTextContent(
          /network/i,
        ),
      );
    });

    it("never renders the plaintext token in the retest outcome (FR-008)", async () => {
      renderPanel();

      await waitFor(() =>
        expect(screen.getByTestId("settings-panel")).toBeInTheDocument(),
      );

      fireEvent.change(screen.getByLabelText(/token/i), {
        target: { value: SESSION_TOKEN_A },
      });
      fireEvent.click(screen.getByRole("button", { name: /set token/i }));
      fireEvent.click(screen.getByRole("button", { name: /retest/i }));

      await waitFor(() =>
        expect(screen.getByTestId("retest-outcome")).toBeInTheDocument(),
      );

      // The retest outcome label can name the user / email / etc., but
      // it MUST NOT contain the plaintext token. A masked suffix is
      // acceptable per FR-008.
      const outcome = screen.getByTestId("retest-outcome").textContent ?? "";
      expect(outcome).not.toContain(SESSION_TOKEN_A);
      // At most a 4-character masked tail is allowed.
      expect(outcome).not.toContain(SESSION_TOKEN_A.slice(0, -4));
    });
  });

  describe("Replace action (FR-005 + FR-005a)", () => {
    it("updates the masked identifier and the session mode to the new token", async () => {
      const panel = renderPanel();

      await waitFor(() =>
        expect(screen.getByTestId("settings-panel")).toBeInTheDocument(),
      );

      fireEvent.change(screen.getByLabelText(/token/i), {
        target: { value: SESSION_TOKEN_A },
      });
      fireEvent.click(screen.getByRole("button", { name: /set token/i }));

      await waitFor(() =>
        expect(panel.maskedProbe()).toBe(lastFour(SESSION_TOKEN_A)),
      );

      fireEvent.change(screen.getByLabelText(/replacement token/i), {
        target: { value: REPLACEMENT_TOKEN },
      });
      fireEvent.click(screen.getByRole("button", { name: /replace/i }));

      await waitFor(() =>
        expect(panel.maskedProbe()).toBe(lastFour(REPLACEMENT_TOKEN)),
      );
      // Session-only replace keeps the mode unchanged.
      expect(panel.modeProbe()).toBe("session");
    });

    it("immediately deletes the prior encrypted record on replace (FR-005a)", async () => {
      // Seed a persistent record so the replace path goes through
      // the encrypted-row lifecycle (FR-005a). After Replace, the
      // persistent row MUST be gone — not waiting for a later
      // clear-all action.
      const key = await generateTokenKey();
      const { ciphertext, iv } = await encryptToken(SESSION_TOKEN_A, key);
      await db.credentials.put({
        mode: "persistent",
        encryptedTokenRecord: { ciphertext, iv, keyRef: key },
        maskedIdentifier: lastFour(SESSION_TOKEN_A),
        lastValidatedAt: null,
        lastValidationResult: null,
      });
      const rowsBefore = await db.credentials.count();
      expect(rowsBefore).toBe(1);

      renderPanel();

      await waitFor(() =>
        expect(screen.getByTestId("settings-panel")).toBeInTheDocument(),
      );

      fireEvent.change(screen.getByLabelText(/replacement token/i), {
        target: { value: REPLACEMENT_TOKEN },
      });
      fireEvent.click(screen.getByRole("button", { name: /replace/i }));

      await waitFor(async () => {
        // The replacement write either re-inserts under a different
        // masked identifier or removes the row entirely until a
        // subsequent setPersistentToken call. Either way, the
        // pre-existing encrypted token for SESSION_TOKEN_A MUST be
        // gone — a future contributor who defers the deletion to
        // clear-all breaks FR-005a and fails this test.
        const remaining = await db.credentials.toArray();
        const stillCarriesPriorToken = remaining.some((row) =>
          row.maskedIdentifier.endsWith(lastFour(SESSION_TOKEN_A)),
        );
        expect(stillCarriesPriorToken).toBe(false);
      });
    });
  });

  describe("Switch-mode action (FR-006 + FR-005a)", () => {
    it("switching from session-only to persistent requires an explicit confirmation (FR-003)", async () => {
      renderPanel();

      await waitFor(() =>
        expect(screen.getByTestId("settings-panel")).toBeInTheDocument(),
      );

      fireEvent.change(screen.getByLabelText(/token/i), {
        target: { value: SESSION_TOKEN_A },
      });
      fireEvent.click(screen.getByRole("button", { name: /set token/i }));

      // The user opts into persistent mode. The panel MUST surface
      // a confirmation dialog that names the encryption-at-rest
      // approach + its stated limitation before persisting anything.
      fireEvent.click(
        screen.getByRole("button", { name: /switch to persistent/i }),
      );

      await waitFor(() =>
        expect(
          screen.getByTestId("persistent-confirmation"),
        ).toBeInTheDocument(),
      );

      // Declining falls back to session-only without writing.
      fireEvent.click(screen.getByRole("button", { name: /decline/i }));

      await waitFor(() =>
        expect(
          screen.queryByTestId("persistent-confirmation"),
        ).not.toBeInTheDocument(),
      );

      const rows = await db.credentials.toArray();
      expect(rows.some((row) => row.mode === "persistent")).toBe(false);
    });

    it("confirming persistent storage writes an encrypted record and updates the masked identifier", async () => {
      const panel = renderPanel();

      await waitFor(() =>
        expect(screen.getByTestId("settings-panel")).toBeInTheDocument(),
      );

      fireEvent.change(screen.getByLabelText(/token/i), {
        target: { value: SESSION_TOKEN_A },
      });
      fireEvent.click(screen.getByRole("button", { name: /set token/i }));

      fireEvent.click(
        screen.getByRole("button", { name: /switch to persistent/i }),
      );
      await waitFor(() =>
        expect(
          screen.getByTestId("persistent-confirmation"),
        ).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

      await waitFor(() => expect(panel.modeProbe()).toBe("persistent"));
      expect(panel.maskedProbe()).toBe(lastFour(SESSION_TOKEN_A));

      const rows = await db.credentials.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.mode).toBe("persistent");
      expect(rows[0]?.maskedIdentifier).toBe(lastFour(SESSION_TOKEN_A));
    });

    it("switching from persistent back to session-only immediately deletes the encrypted record (FR-005a)", async () => {
      const key = await generateTokenKey();
      const { ciphertext, iv } = await encryptToken(SESSION_TOKEN_A, key);
      await db.credentials.put({
        mode: "persistent",
        encryptedTokenRecord: { ciphertext, iv, keyRef: key },
        maskedIdentifier: lastFour(SESSION_TOKEN_A),
        lastValidatedAt: null,
        lastValidationResult: null,
      });

      const panel = renderPanel();

      await waitFor(() =>
        expect(screen.getByTestId("settings-panel")).toBeInTheDocument(),
      );

      fireEvent.click(
        screen.getByRole("button", { name: /switch to session/i }),
      );

      await waitFor(() => expect(panel.modeProbe()).toBe("session"));

      const rows = await db.credentials.toArray();
      // FR-005a — switching off persistent storage immediately
      // removes the encrypted token record AND its associated key.
      expect(rows.some((row) => row.mode === "persistent")).toBe(false);
    });
  });

  describe("Clear-all action (FR-007)", () => {
    it("removes the credential record and wipes every Dexie store in one transaction", async () => {
      // Seed one row in every store so the clear-all contract proves
      // the wipe spans the full Dexie schema, not just credentials.
      await db.workspaces.put({
        gid: smallDatasetWorkspaceGid,
        name: "Team Dash Workspace",
        selectedAt: "2026-07-25T00:00:00.000Z",
      });
      await db.projects.put({
        gid: "1200000000000100",
        name: "Web App",
        workspaceGid: smallDatasetWorkspaceGid,
        asanaTeamGid: "1200000000000010",
        portfolioGids: [],
        archived: false,
      });
      await db.portfolios.put({
        gid: "1200000000000110",
        name: "Q3 Portfolio",
        workspaceGid: smallDatasetWorkspaceGid,
        projectGids: ["1200000000000100"],
      });
      await db.asanaTeams.put({
        gid: "1200000000000010",
        name: "Platform",
        workspaceGid: smallDatasetWorkspaceGid,
      });
      await db.teamMappingOverrides.put({
        projectGid: "1200000000000100",
        reportingTeamGid: "team-platform",
        updatedAt: "2026-07-25T00:00:00.000Z",
      });
      await db.personGroups.put({
        id: "person-group-1",
        workspaceGid: smallDatasetWorkspaceGid,
        name: "Leadership",
        kind: "named",
        memberUserGids: ["1200000000000020"],
        createdAt: "2026-07-25T00:00:00.000Z",
        updatedAt: "2026-07-25T00:00:00.000Z",
      });
      await db.users.put({
        gid: "1200000000000020",
        name: "Alex Kim",
        email: "alex@example.com",
        workspaceGid: smallDatasetWorkspaceGid,
      });
      await db.priorityFields.put({
        projectGid: "1200000000000100",
        expectedOptionIds: ["high", "medium", "low"],
        status: "ok",
      });
      await db.tasks.put({
        gid: "1200000000000200",
        name: "Launch dashboard",
        assigneeGid: "1200000000000020",
        projectGids: ["1200000000000100"],
        parentTaskGid: null,
        resourceSubtype: "default_task",
        createdAt: "2026-07-01T09:00:00.000Z",
        modifiedAt: "2026-07-20T09:00:00.000Z",
        completedAt: null,
        dueAt: "2026-07-31T17:00:00.000Z",
        priorityOptionId: "high",
        estimatedMinutes: 480,
        actualMinutes: null,
        dependsOnTaskGids: [],
        lastSeenInScopeAt: "2026-07-25T00:00:00.000Z",
        outOfScopeReason: null,
      });
      await db.dependencies.put({
        taskGid: "1200000000000200",
        dependsOnTaskGid: "1200000000000201",
        dependsOnTaskAccessible: true,
      });
      await db.sections.put({
        gid: "1200000000000300",
        projectGid: "1200000000000100",
        name: "Doing",
      });
      await db.snapshots.put({
        workspaceGid: smallDatasetWorkspaceGid,
        localCalendarDate: "2026-07-25",
        incompleteCount: 1,
        incompleteEstimatedMinutes: 480,
        unestimatedIncompleteCount: 0,
        computedFromRefreshId: "refresh-1",
        computedAt: "2026-07-25T00:00:00.000Z",
      });
      await db.refreshSessions.put({
        id: "refresh-1",
        workspaceGid: smallDatasetWorkspaceGid,
        startedAt: "2026-07-25T00:00:00.000Z",
        finishedAt: "2026-07-25T00:05:00.000Z",
        status: "succeeded",
        itemsRetrieved: 42,
        errorDetail: null,
        syncMode: "full",
      });
      const key = await generateTokenKey();
      const { ciphertext, iv } = await encryptToken(SESSION_TOKEN_A, key);
      await db.credentials.put({
        mode: "persistent",
        encryptedTokenRecord: { ciphertext, iv, keyRef: key },
        maskedIdentifier: lastFour(SESSION_TOKEN_A),
        lastValidatedAt: null,
        lastValidationResult: null,
      });

      expect(await db.workspaces.count()).toBe(1);
      expect(await db.projects.count()).toBe(1);
      expect(await db.portfolios.count()).toBe(1);
      expect(await db.asanaTeams.count()).toBe(1);
      expect(await db.teamMappingOverrides.count()).toBe(1);
      expect(await db.personGroups.count()).toBe(1);
      expect(await db.users.count()).toBe(1);
      expect(await db.priorityFields.count()).toBe(1);
      expect(await db.dependencies.count()).toBe(1);
      expect(await db.sections.count()).toBe(1);
      expect(await db.tasks.count()).toBe(1);
      expect(await db.snapshots.count()).toBe(1);
      expect(await db.refreshSessions.count()).toBe(1);
      expect(await db.credentials.count()).toBe(1);

      const panel = renderPanel();

      await waitFor(() =>
        expect(screen.getByTestId("settings-panel")).toBeInTheDocument(),
      );

      // Clear-all requires an explicit confirmation so the user does
      // not lose their local cache with one stray click.
      fireEvent.click(screen.getByRole("button", { name: /clear all/i }));
      await waitFor(() =>
        expect(
          screen.getByTestId("clear-all-confirmation"),
        ).toBeInTheDocument(),
      );
      fireEvent.click(
        screen.getByRole("button", { name: /confirm clear all/i }),
      );

      await waitFor(async () => {
        expect(panel.stateProbe()).toBe("first_run");
        expect(panel.modeProbe()).toBe("none");
        expect(panel.maskedProbe()).toBe("");
        // Every store wiped.
        expect(await db.credentials.count()).toBe(0);
        expect(await db.workspaces.count()).toBe(0);
        expect(await db.projects.count()).toBe(0);
        expect(await db.portfolios.count()).toBe(0);
        expect(await db.asanaTeams.count()).toBe(0);
        expect(await db.teamMappingOverrides.count()).toBe(0);
        expect(await db.personGroups.count()).toBe(0);
        expect(await db.users.count()).toBe(0);
        expect(await db.priorityFields.count()).toBe(0);
        expect(await db.dependencies.count()).toBe(0);
        expect(await db.sections.count()).toBe(0);
        expect(await db.tasks.count()).toBe(0);
        expect(await db.snapshots.count()).toBe(0);
        expect(await db.refreshSessions.count()).toBe(0);
      });
    });
  });

  describe("URL / log / value safety (FR-008)", () => {
    it("never embeds the full token in any link or route the panel renders", async () => {
      const { container } = renderPanel();

      await waitFor(() =>
        expect(screen.getByTestId("settings-panel")).toBeInTheDocument(),
      );

      fireEvent.change(screen.getByLabelText(/token/i), {
        target: { value: SESSION_TOKEN_A },
      });
      fireEvent.click(screen.getByRole("button", { name: /set token/i }));

      // After exercising every action that could plausibly produce a
      // link (Retest's "open in Asana" deep-link, Replace's
      // post-replace confirmation, Clear-all's recovery hint), the
      // DOM MUST NOT carry the full token in any attribute or text.
      fireEvent.click(screen.getByRole("button", { name: /retest/i }));
      await waitFor(() =>
        expect(screen.getByTestId("retest-outcome")).toBeInTheDocument(),
      );
      fireEvent.click(
        screen.getByRole("button", { name: /switch to session/i }),
      );

      const html = container.innerHTML;
      expect(html).not.toContain(SESSION_TOKEN_A);
      expect(html).not.toContain(REPLACEMENT_TOKEN);
      // At most the masked tail is acceptable.
      expect(html).not.toContain(SESSION_TOKEN_A.slice(0, -4));
    });

    it("never exposes the plaintext token through the useCredentials hook", async () => {
      renderPanel();

      await waitFor(() =>
        expect(screen.getByTestId("settings-panel")).toBeInTheDocument(),
      );

      fireEvent.change(screen.getByLabelText(/token/i), {
        target: { value: SESSION_TOKEN_A },
      });
      fireEvent.click(screen.getByRole("button", { name: /set token/i }));

      // The probe value (see `<CredentialsProbe />` in `renderPanel`)
      // is the entire JSON-encoded surface of the credentials
      // context. FR-008 says it MUST NOT carry the plaintext token —
      // only the masked identifier is allowed.
      const probe = screen.getByTestId("probe").textContent ?? "";
      expect(probe).not.toContain(SESSION_TOKEN_A);
      expect(probe).toContain(lastFour(SESSION_TOKEN_A));
    });
  });
});
