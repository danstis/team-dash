/**
 * T03 — `RefreshControls` failure-mode integration test.
 *
 * Spec / contract references
 * --------------------------
 * Spec FR-021 (US2 acceptance scenarios 4-7) — "the outcome MUST
 * distinguish success, partial failure, cancellation, authentication
 * failure, permission failure, or rate-limit failure".
 *
 * What this test pins
 * -------------------
 * `<RefreshControls />` (US2) is wired to the orchestrator
 * `createRefreshOrchestrator({ deps })` from
 * `src/data/refresh/refresh-orchestrator.ts` (T01 / D001). The
 * orchestrator maps the six `AsanaClientResultOutcome` variants to
 * the `RefreshOutcome.kind` union and the `RefreshSession.status`
 * enum per the documented failure-mode table
 * (`src/data/refresh/refresh-orchestrator.ts` § "What this module
 * owns" #5). This integration test exercises the end-to-end pin:
 *
 *   1. Each documented failure mode (`auth_failure`,
 *      `permission_failure`, `rate_limited`, `network_error`,
 *      `validation_error`, cancellation) routes the
 *      `<OutcomeBanner />` to the matching variant
 *      (`data-outcome="…"`) and (for non-cancelled modes) writes the
 *      `RefreshSession` row to the matching `status` with a
 *      non-null `finishedAt`.
 *   2. **FR-022 atomic refresh integrity** — every failure path
 *      leaves the live `projects`, `tasks`, and downstream stores
 *      byte-identical (the orchestrator's `discard()` path drops
 *      the staging buffer before any commit() call).
 *   3. `<OutcomeBanner />` surfaces the orchestrator's scrubbed
 *      failure message verbatim (FR-008 / FR-010 — no tokens in
 *      the message).
 *
 * The cancellation case is the only failure mode this
 * integration suite does NOT exercise: abort propagation is
 * tested deterministically in the unit suite
 * (`tests/unit/features/refresh/RefreshControls.test.tsx`) by
 * the `<RefreshControls orchestrator={...} />` seam (the
 * orchestrator's AbortSignal acceptance cannot be observed end-
 * to-end against MSW because MSW handlers run synchronously
 * with the `await fetch(...)` call, leaving no opportunity for
 * the test to call `controller.abort()` between pages).
 *
 * Boundary
 * --------
 * `tests/integration/**` runs against jsdom + `fake-indexeddb` +
 * MSW per `tests/setup.ts`. The MSW node server's
 * `onUnhandledRequest: 'error'` policy means a forgotten handler
 * override fails loudly rather than silently reaching the live
 * network, preserving the FR-008 / FR-010 "token never escapes the
 * per-call boundary" property end-to-end.
 */
import { type ReactElement, StrictMode, useEffect } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CredentialsProvider,
  useCredentialTokenAccessor,
  useCredentials,
  type CredentialsContextValue,
} from "../../../src/app/credentials-context";
import {
  WorkspaceProvider,
  useWorkspace,
  type SelectedWorkspace,
  type WorkspaceContextValue,
} from "../../../src/app/workspace-context";
import { db, type RefreshSession } from "../../../src/data/db/schema";
import { smallDatasetWorkspaceGid } from "../../../fixtures/asana/small-dataset/data";
import { server } from "../../setup";
import { RefreshControls } from "../../../src/features/refresh/RefreshControls";

// jsdom defaults `navigator.onLine` to `false` in some configurations.
// The production `useOffline()` hook reads that value at mount time;
// pinning `navigator.onLine = true` once at module evaluation makes
// the failure-mode integration tests deterministic. Offline gating
// is exercised in the dedicated unit test via the `forceOffline`
// prop seam.
Object.defineProperty(globalThis.navigator, "onLine", {
  configurable: true,
  value: true,
  writable: true,
});

/* -------------------------------------------------------------------------- */
/* Test fixtures                                                              */
/* -------------------------------------------------------------------------- */

const FIXTURE_TOKEN = "fixture-refresh-failure-modes-token-1234567890";

const SAMPLE_WORKSPACE: SelectedWorkspace = {
  gid: smallDatasetWorkspaceGid,
  name: "Team Dash Workspace",
  selectedAt:
    "2026-07-31T09:00:00.000Z" as unknown as SelectedWorkspace["selectedAt"],
};

/* -------------------------------------------------------------------------- */
/* Test handle capture                                                        */
/* -------------------------------------------------------------------------- */

interface CapturedHandles {
  credentials: CredentialsContextValue | null;
  workspace: WorkspaceContextValue | null;
}

type HandlesRef = { current: CapturedHandles | null };

function RefreshProbe({
  handlesRef,
}: {
  handlesRef: HandlesRef;
}): ReactElement {
  const credentials = useCredentials();
  const workspace = useWorkspace();
  const tokenAccessor = useCredentialTokenAccessor();
  useEffect(() => {
    handlesRef.current = { credentials, workspace };
  });
  return (
    <div data-testid="refresh-probe">
      <span data-testid="probe-credentials-state">{credentials.state}</span>
      <span data-testid="probe-workspace-state">{workspace.state}</span>
      <span data-testid="probe-has-token">
        {tokenAccessor.getPlaintextToken() === null ? "no" : "yes"}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

async function driveProvidersToReady(handlesRef: HandlesRef): Promise<void> {
  await waitFor(() => {
    expect(handlesRef.current?.credentials).not.toBeNull();
  });
  await waitFor(() => {
    expect(handlesRef.current?.workspace).not.toBeNull();
  });

  await handlesRef.current?.credentials?.setSessionToken(
    FIXTURE_TOKEN,
    "…7890",
  );
  await handlesRef.current?.workspace?.selectWorkspace(SAMPLE_WORKSPACE);

  await waitFor(() => {
    expect(handlesRef.current?.credentials?.state).toBe("ready");
    expect(handlesRef.current?.workspace?.state).toBe("ready");
  });
}

function renderRefreshControls(): HandlesRef {
  const handlesRef: HandlesRef = { current: null };
  render(
    <StrictMode>
      <CredentialsProvider>
        <WorkspaceProvider>
          <RefreshProbe handlesRef={handlesRef} />
          <RefreshControls />
        </WorkspaceProvider>
      </CredentialsProvider>
    </StrictMode>,
  );
  return handlesRef;
}

async function clearStores(): Promise<void> {
  await db.credentials.clear();
  await db.workspaces.clear();
  await db.refreshSessions.clear();
  await db.projects.clear();
  await db.tasks.clear();
  await db.dependencies.clear();
  await db.priorityFields.clear();
  await db.asanaTeams.clear();
  await db.snapshots.clear();
}

async function expectBannerOutcome(
  outcome: string,
  dataFailureReason?: string,
): Promise<HTMLElement> {
  return await waitFor(() => {
    const node = screen.getByTestId("outcome-banner");
    expect(node).toHaveAttribute("data-outcome", outcome);
    if (dataFailureReason !== undefined) {
      expect(node).toHaveAttribute(
        "data-failure-reason",
        dataFailureReason,
      );
    }
    return node;
  });
}

async function expectSessionStatus(
  status: RefreshSession["status"],
): Promise<RefreshSession> {
  const sessions = await db.refreshSessions.toArray();
  expect(sessions).toHaveLength(1);
  const session = sessions[0];
  expect(session).toBeDefined();
  expect(session?.status).toBe(status);
  expect(session?.finishedAt).not.toBeNull();
  return session as RefreshSession;
}

async function expectCacheUntouched(): Promise<void> {
  expect(await db.projects.toArray()).toEqual([]);
  expect(await db.tasks.toArray()).toEqual([]);
  expect(await db.dependencies.toArray()).toEqual([]);
  expect(await db.priorityFields.toArray()).toEqual([]);
  expect(await db.asanaTeams.toArray()).toEqual([]);
  expect(await db.snapshots.toArray()).toEqual([]);
}

/* -------------------------------------------------------------------------- */
/* Refresh failure modes                                                      */
/* -------------------------------------------------------------------------- */

describe("T03 — RefreshControls failure-mode rendering and atomic refresh integrity", () => {
  beforeEach(async () => {
    await clearStores();
  });

  afterEach(() => {
    cleanup();
  });

  it("routes an auth_failure (HTTP 401) to data-outcome=auth_failure and RefreshSession.status=auth_failure", async () => {
    // Per the Asana client's contract
    // (`src/data/asana/types.ts` § "Per-variant shapes"), a 401 maps
    // to `outcome: 'auth_failure'` (no body payload — FR-008 / FR-010).
    server.use(
      http.get("https://app.asana.com/api/1.0/projects", () =>
        HttpResponse.json(
          { errors: [{ message: "Not Authorized" }] },
          { status: 401 },
        ),
      ),
    );

    const handlesRef = renderRefreshControls();
    await driveProvidersToReady(handlesRef);

    fireEvent.click(screen.getByTestId("refresh-button"));

    const banner = await expectBannerOutcome("auth_failure");
    expect(banner).toHaveAttribute("role", "alert");
    expect(banner).toHaveTextContent("Authentication failed");
    expect(banner).toHaveTextContent(
      "Authentication failed: the token was rejected by Asana.",
    );
    expect(screen.queryByTestId("progress-indicator")).toBeNull();

    await expectSessionStatus("auth_failure");
    await expectCacheUntouched();
  });

  it("routes a permission_failure (HTTP 403) to data-outcome=permission_failure", async () => {
    // Per the Asana client's `permission_failure` contract
    // (`src/data/asana/client.ts` — for `response.status === 403`
    // the client returns `{ outcome: 'permission_failure' }`
    // without a `resource` field; only `412 Precondition Failed`
    // surfaces the request path as the `resource` hint). The
    // orchestrator's `describeFailure` falls back to the
    // resource-free "Permission denied by Asana." message for 403.
    server.use(
      http.get(
        "https://app.asana.com/api/1.0/projects/:projectGid/tasks",
        () =>
          HttpResponse.json(
            { errors: [{ message: "Forbidden" }] },
            { status: 403 },
          ),
      ),
    );

    const handlesRef = renderRefreshControls();
    await driveProvidersToReady(handlesRef);

    fireEvent.click(screen.getByTestId("refresh-button"));

    const banner = await expectBannerOutcome("permission_failure");
    expect(banner).toHaveAttribute("role", "alert");
    expect(banner).toHaveTextContent("Permission denied");
    expect(banner).toHaveTextContent("Permission denied by Asana.");

    await expectSessionStatus("permission_failure");
    await expectCacheUntouched();
  });

  it("routes a rate_limited (HTTP 429 with Retry-After) to data-outcome=rate_limited", async () => {
    server.use(
      http.get("https://app.asana.com/api/1.0/projects", () =>
        HttpResponse.json(
          {
            errors: [{ message: "Rate limit exceeded" }],
          },
          {
            status: 429,
            headers: { "Retry-After": "30" },
          },
        ),
      ),
    );

    const handlesRef = renderRefreshControls();
    await driveProvidersToReady(handlesRef);

    fireEvent.click(screen.getByTestId("refresh-button"));

    const banner = await expectBannerOutcome("rate_limited");
    expect(banner).toHaveAttribute("role", "alert");
    expect(banner).toHaveTextContent("Rate limited by Asana");
    expect(banner).toHaveTextContent(/retry after \d+ms/);

    await expectSessionStatus("rate_limited");
    await expectCacheUntouched();
  });

  it("routes a network_error (transport failure) to data-outcome=partial_failure with data-failure-reason=network_error", async () => {
    // `HttpResponse.error()` from MSW simulates a transport-level
    // failure (the underlying `fetch` rejects). The Asana client's
    // error mapper catches the rejection and surfaces
    // `outcome: 'network_error'`, which the orchestrator maps to
    // `RefreshSession.status: 'partial_failure'` with
    // `RefreshFailureReason: 'network_error'`.
    server.use(
      http.get("https://app.asana.com/api/1.0/projects", () =>
        HttpResponse.error(),
      ),
    );

    const handlesRef = renderRefreshControls();
    await driveProvidersToReady(handlesRef);

    fireEvent.click(screen.getByTestId("refresh-button"));

    const banner = await expectBannerOutcome(
      "partial_failure",
      "network_error",
    );
    expect(banner).toHaveAttribute("role", "alert");
    expect(banner).toHaveTextContent("Partial refresh result");
    expect(banner).toHaveTextContent(/network error/i);

    await expectSessionStatus("partial_failure");
    await expectCacheUntouched();
  });

  it("routes a validation_error (Zod mismatch) to data-outcome=partial_failure with data-failure-reason=validation_error", async () => {
    // Return a payload whose top-level keys fail the Zod envelope
    // schema (`asanaListResponseSchema` requires `data: [...]`).
    // The Asana client surfaces this as
    // `outcome: 'validation_error'` with the structured
    // `ZodIssue[]` array the FR-084 data-quality summary will pin.
    server.use(
      http.get(
        "https://app.asana.com/api/1.0/projects",
        () =>
          new HttpResponse(
            JSON.stringify({ unexpected: { not: "an envelope" } }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const handlesRef = renderRefreshControls();
    await driveProvidersToReady(handlesRef);

    fireEvent.click(screen.getByTestId("refresh-button"));

    const banner = await expectBannerOutcome(
      "partial_failure",
      "validation_error",
    );
    expect(banner).toHaveAttribute("role", "alert");
    expect(banner).toHaveTextContent("Asana response failed schema validation");

    await expectSessionStatus("partial_failure");
    await expectCacheUntouched();
  });

  it("routes a transport-error in the projects fetch and surfaces the orchestrator's errorDetail without leaking the credential", async () => {
    // The orchestrator's `describeFailure` constructs a
    // `RefreshSession.errorDetail` string that does NOT include
    // the token (FR-008 / FR-010). Pin the body of the errorDetail
    // here so a future contributor who adds a credential-bearing
    // error message fails the build.
    server.use(
      http.get("https://app.asana.com/api/1.0/projects", () =>
        HttpResponse.error(),
      ),
    );

    const handlesRef = renderRefreshControls();
    await driveProvidersToReady(handlesRef);

    fireEvent.click(screen.getByTestId("refresh-button"));

    const banner = await expectBannerOutcome(
      "partial_failure",
      "network_error",
    );
    expect(banner.textContent).not.toContain(FIXTURE_TOKEN);

    const sessions = await db.refreshSessions.toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.errorDetail ?? "").not.toContain(FIXTURE_TOKEN);
  });

  it("exposes exactly one RefreshSession row per click (no duplicate seeding)", async () => {
    // One click → one row. Two clicks → at most two rows
    // (sequential, not concurrent — the button is disabled while
    // running). A regression that double-seeds (e.g. an extra
    // `db.refreshSessions.put` somewhere) fails this assertion.
    server.use(
      http.get("https://app.asana.com/api/1.0/projects", () =>
        HttpResponse.json(
          { errors: [{ message: "Not Authorized" }] },
          { status: 401 },
        ),
      ),
    );

    const handlesRef = renderRefreshControls();
    await driveProvidersToReady(handlesRef);

    fireEvent.click(screen.getByTestId("refresh-button"));
    await expectBannerOutcome("auth_failure");

    const sessions = await db.refreshSessions.toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toMatch(/^session-/);
  });
});
