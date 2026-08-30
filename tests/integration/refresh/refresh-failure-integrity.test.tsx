/**
 * T051 — Refresh failure integrity red→green (US2, BSOD-305).
 *
 * This is the Red half of T051's Red/Green/Refactor (Constitution Principle
 * III). The four failure modes (network failure / auth failure / rate-limit /
 * user-cancel) each must:
 *
 *   (a) report the specific reason via `OutcomeBanner`; and
 *   (b) leave the previously complete cache byte-identical in Dexie
 *       (`tests/contract/refresh-staging.test.ts` is the unit-level
 *       guarantee that `discard()` is byte-identical; this test pins the
 *       end-to-end invariant that the orchestrator calls `discard()`
 *       — never `commit()` — on every failure path, so the cache stays
 *       intact even when the failure surfaces through the UI).
 *
 * What this file asserts (verbatim from the task row and FR-021/FR-022):
 *
 *   - **Network failure** mid-refresh — Asana returns a 503 (or the
 *     orchestrator detects a `network_error` outcome). The
 *     `OutcomeBanner` surfaces a distinct "network" reason
 *     (`data-outcome-reason="network"`). The previous complete cache is
 *     byte-identical: every Task / Project row written by the previous
 *     successful refresh is still present with the same `gid`, the
 *     same `modifiedAt`, the same fields. `RefreshSession.status` is
 *     NOT `succeeded`.
 *
 *   - **Auth failure** — Asana returns a 401. The `OutcomeBanner`
 *     surfaces a distinct "auth" reason
 *     (`data-outcome-reason="auth_failure"`). Cache byte-identical.
 *     `RefreshSession.status` reflects the terminal auth_failure.
 *
 *   - **Rate-limit** — Asana returns a 429. The `OutcomeBanner`
 *     surfaces a distinct "rate_limited" reason
 *     (`data-outcome-reason="rate_limited"`). Cache byte-identical.
 *
 *   - **User-cancel** — the orchestrator's `AbortSignal` fires mid-
 *     refresh. The `OutcomeBanner` surfaces a distinct "cancelled"
 *     reason (`data-outcome-reason="cancelled"`). Cache byte-identical.
 *
 * Each scenario is a separate `it(...)` so a single failing case
 * surfaces the specific failure mode in the test report.
 *
 * ## Test-first discipline
 *
 * Per Constitution Principle III, this file ships before any
 * orchestrator / `OutcomeBanner` implementation lands. The Red-phase
 * failure modes for the four scenarios are:
 *
 *   - "Cannot find module `../../../src/data/refresh/refresh-orchestrator`"
 *     for the orchestrator import;
 *   - "Cannot find module `../../../src/features/refresh/RefreshControls`"
 *     for the `OutcomeBanner` import.
 *
 * The same suite becomes GREEN once the orchestrator + `OutcomeBanner`
 * land (this row's Green PR), without any test-side changes.
 *
 * ## Why an integration test (not a unit test)
 *
 * The contract tests in `tests/contract/refresh-staging.test.ts` pin
 * the storage-layer guarantee that `discard()` is byte-identical. This
 * file crosses both the orchestrator and the feature boundary to pin
 * the end-to-end invariant the spec's headline contract rests on:
 *
 *   "A failed, cancelled, or incomplete refresh MUST NOT replace a
 *    previously complete cache with partial data." (FR-022)
 *
 * Plus the FR-021 outcome visibility — "on completion MUST show the
 * outcome … along with … whether currently displayed data is cached or
 * fresh" — which is the UI half the orchestrator cannot satisfy on its
 * own.
 *
 * The orchestrator is exercised against MSW (the
 * `tests/setup.ts`-bootstrapped server + per-test `server.use(...)`
 * overrides), Dexie's `fake-indexeddb` (already wired by
 * `tests/setup.ts`), and a minimal `<OutcomeBanner>` mounted inside the
 * shell context. The previous complete cache is seeded into the same
 * Dexie instance the orchestrator writes through.
 *
 * ## Boundary
 *
 * `tests/integration/**` runs against jsdom + Dexie `fake-indexeddb` +
 * MSW. No browser, no live Asana, no real PAT.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { type ReactElement, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type RefreshOutcome,
  type RefreshFailureReason,
  refreshOrchestrator,
} from "../../../src/data/refresh/refresh-orchestrator";
import {
  OutcomeBanner,
  type OutcomeBannerProps,
} from "../../../src/features/refresh/RefreshControls";
import { cacheRepository } from "../../../src/data/db/repositories/cache.repository";
import { db } from "../../../src/data/db/schema";
import type {
  Project,
  RefreshSession,
  Task,
} from "../../../src/data/db/schema";
import { server } from "../../../src/mocks/server";

/* -------------------------------------------------------------------------- */
/* Fixtures (deterministic; no live Asana)                                    */
/* -------------------------------------------------------------------------- */

const WORKSPACE_GID = "ws-t051";

const PRE_REFRESH_PROJECTS: Project[] = [
  {
    gid: "proj-pre-1",
    name: "Pre-refresh project one",
    workspaceGid: WORKSPACE_GID,
    asanaTeamGid: "team-1",
    portfolioGids: [],
    archived: false,
  },
  {
    gid: "proj-pre-2",
    name: "Pre-refresh project two",
    workspaceGid: WORKSPACE_GID,
    asanaTeamGid: "team-1",
    portfolioGids: [],
    archived: false,
  },
];

const PRE_REFRESH_TASKS: Task[] = [
  {
    gid: "task-pre-1",
    name: "Pre-refresh task one",
    assigneeGid: null,
    projectGids: ["proj-pre-1"],
    parentTaskGid: null,
    resourceSubtype: "default_task",
    createdAt: "2026-07-01T09:00:00.000Z",
    modifiedAt: "2026-07-15T09:00:00.000Z",
    completedAt: null,
    dueAt: null,
    priorityOptionId: null,
    estimatedMinutes: null,
    actualMinutes: null,
    dependsOnTaskGids: [],
    lastSeenInScopeAt: "2026-07-25T00:00:00.000Z",
    outOfScopeReason: null,
  },
  {
    gid: "task-pre-2",
    name: "Pre-refresh task two",
    assigneeGid: "user-1",
    projectGids: ["proj-pre-2"],
    parentTaskGid: null,
    resourceSubtype: "default_task",
    createdAt: "2026-07-02T09:00:00.000Z",
    modifiedAt: "2026-07-15T09:00:00.000Z",
    completedAt: null,
    dueAt: null,
    priorityOptionId: null,
    estimatedMinutes: 60,
    actualMinutes: null,
    dependsOnTaskGids: [],
    lastSeenInScopeAt: "2026-07-25T00:00:00.000Z",
    outOfScopeReason: null,
  },
  {
    gid: "task-pre-3",
    name: "Pre-refresh task three",
    assigneeGid: null,
    projectGids: ["proj-pre-1", "proj-pre-2"],
    parentTaskGid: null,
    resourceSubtype: "default_task",
    createdAt: "2026-07-03T09:00:00.000Z",
    modifiedAt: "2026-07-15T09:00:00.000Z",
    completedAt: "2026-07-20T09:00:00.000Z",
    dueAt: null,
    priorityOptionId: null,
    estimatedMinutes: 30,
    actualMinutes: 45,
    dependsOnTaskGids: [],
    lastSeenInScopeAt: "2026-07-25T00:00:00.000Z",
    outOfScopeReason: null,
  },
];

/**
 * Snapshot the current Dexie state (projects + tasks + refreshSessions)
 * so a per-test assertion can compare pre- and post-refresh byte-
 * identity without depending on a particular ordering of keys or
 * implicit serialisation. Dexie's `toArray()` returns plain objects
 * sorted by primary key — identical to what the contract test's
 * `getInScopeTasks()` would observe, so a successful test passes
 * both "the entity tables are unchanged" and "the in-scope predicate
 * still returns the original rows".
 */
async function snapshotPreRefreshState(): Promise<{
  projects: Project[];
  tasks: Task[];
  sessions: RefreshSession[];
}> {
  const [projects, tasks, sessions] = await Promise.all([
    db.projects.toArray(),
    db.tasks.toArray(),
    db.refreshSessions.toArray(),
  ]);
  return { projects, tasks, sessions };
}

async function clearAllStores(): Promise<void> {
  await db.workspaces.clear();
  await db.projects.clear();
  await db.tasks.clear();
  await db.refreshSessions.clear();
}

async function seedPreRefreshState(): Promise<void> {
  await cacheRepository.upsertProjects(PRE_REFRESH_PROJECTS);
  await cacheRepository.upsertTasks(PRE_REFRESH_TASKS);
}

/**
 * The orchestrator's caller-supplied failure-injection mode. The test
 * harness uses these per-scenario overrides so each `it(...)` focuses
 * on one failure mode without changing the orchestrator interface.
 *
 * The four scenarios are mapped 1:1 to the four per-test MSW
 * overrides below — the MSW handler is the source of truth for the
 * Asana-side failure (the orchestrator is what classifies the failure
 * into one of the four documented reasons); the cancellation scenario
 * uses an `AbortController` instead.
 */
type FailureInjectionMode =
  "none" | "network_error" | "auth_failure" | "rate_limited";

interface HarnessProps {
  workspaceGid: string;
  injection: FailureInjectionMode;
  abortAfterFirstProjectsPage: boolean;
  outcomeToRender: RefreshOutcome | null;
  onOutcomeRendered?: (banner: HTMLElement | null) => void;
}

function OutcomeHarness({
  workspaceGid,
  injection,
  abortAfterFirstProjectsPage,
  outcomeToRender,
}: HarnessProps): ReactElement {
  useEffect(() => {
    /* Effect slot reserved for future render-spy wiring; intentionally
     * empty so the harness's published-shape stays stable across
     * tests that add render-counting without touching this file. */
    return undefined;
  });

  if (outcomeToRender === null) {
    return <div data-testid="harness-empty">no outcome yet</div>;
  }

  const props = bannerPropsFromOutcome(outcomeToRender);
  return (
    <div data-testid="harness">
      <OutcomeBanner {...props} data-testid="outcome-banner" />
      <span data-testid="harness-workspace">{workspaceGid}</span>
      <span data-testid="harness-injection">{injection}</span>
      <span data-testid="harness-abort">
        {abortAfterFirstProjectsPage ? "yes" : "no"}
      </span>
    </div>
  );
}

function bannerPropsFromOutcome(outcome: RefreshOutcome): OutcomeBannerProps {
  switch (outcome.status) {
    case "succeeded":
      return {
        state: "succeeded",
        itemsRetrieved: outcome.itemsRetrieved,
      };
    case "cancelled":
      return {
        state: "cancelled",
      };
    case "failed":
      return {
        state: "failed",
        reason: outcome.reason,
        message: outcome.message,
      };
  }
}

/* -------------------------------------------------------------------------- */
/* MSW failure injection helpers                                              */
/* -------------------------------------------------------------------------- */

const ASANA_API_BASE = "https://app.asana.com/api/1.0";

/**
 * Override every Asana GET endpoint to return the failure the test
 * scenario needs. The orchestrator reads the same `asanaHandlers`
 * URL shape as the small-dataset fixture; the override is broader
 * than the orchestrator's actual request shape (only `/projects` is
 * hit during the projects page of the refresh) but a blanket override
 * keeps the test resilient to the orchestrator's exact fetch order.
 */
function installAsanaFailureOverride(
  mode: Exclude<FailureInjectionMode, "none">,
): void {
  server.use(
    http.get(`${ASANA_API_BASE}/projects`, ({ request }) => {
      if (!request.headers.get("Authorization")?.startsWith("Bearer ")) {
        return HttpResponse.json(
          { errors: [{ message: "Not Authorized" }] },
          { status: 401 },
        );
      }
      switch (mode) {
        case "network_error":
          return new Response(null, { status: 503 });
        case "auth_failure":
          return HttpResponse.json(
            { errors: [{ message: "Not Authorized" }] },
            { status: 401 },
          );
        case "rate_limited":
          return HttpResponse.json(
            { errors: [{ message: "Rate limit exceeded" }] },
            {
              status: 429,
              headers: { "Retry-After": "30" },
            },
          );
      }
    }),
    http.get(`${ASANA_API_BASE}/projects/:projectGid/tasks`, () => {
      // Subsequent task-page requests are unreachable in the failure
      // scenarios — the orchestrator should bail on the first projects
      // page failure. The handler is installed for symmetry so a future
      // orchestrator change that does an early task-page probe still
      // sees the same failure.
      return new Response(null, { status: 503 });
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Test suite                                                                 */
/* -------------------------------------------------------------------------- */

describe("T051 [US2] refresh failure integrity — failure reasons + cache intact", () => {
  beforeEach(async () => {
    await clearAllStores();
    await seedPreRefreshState();
  });

  afterEach(async () => {
    cleanup();
    await clearAllStores();
  });

  it("renders a distinct 'network' reason in OutcomeBanner and preserves the previous complete cache", async () => {
    installAsanaFailureOverride("network_error");
    const preSnapshot = await snapshotPreRefreshState();

    const result = await refreshOrchestrator.runRefresh({
      workspaceGid: WORKSPACE_GID,
      token: "test-token-value",
    });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.reason).toBe<RefreshFailureReason>("network_error");

    render(
      <OutcomeHarness
        workspaceGid={WORKSPACE_GID}
        injection="network_error"
        abortAfterFirstProjectsPage={false}
        outcomeToRender={result}
        onOutcomeRendered={() => undefined}
      />,
    );

    const banner = await screen.findByTestId("outcome-banner");
    expect(banner.getAttribute("data-outcome-state")).toBe("failed");
    expect(banner.getAttribute("data-outcome-reason")).toBe("network_error");
    expect(banner.getAttribute("data-outcome-cache-intact")).toBe("true");

    const postSnapshot = await snapshotPreRefreshState();
    expect(postSnapshot.projects).toEqual(preSnapshot.projects);
    expect(postSnapshot.tasks).toEqual(preSnapshot.tasks);

    const sessions = postSnapshot.sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.status).not.toBe("succeeded");
  });

  it("renders a distinct 'auth_failure' reason in OutcomeBanner and preserves the previous complete cache", async () => {
    installAsanaFailureOverride("auth_failure");
    const preSnapshot = await snapshotPreRefreshState();

    const result = await refreshOrchestrator.runRefresh({
      workspaceGid: WORKSPACE_GID,
      token: "test-token-value",
    });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.reason).toBe<RefreshFailureReason>("auth_failure");

    render(
      <OutcomeHarness
        workspaceGid={WORKSPACE_GID}
        injection="auth_failure"
        abortAfterFirstProjectsPage={false}
        outcomeToRender={result}
        onOutcomeRendered={() => undefined}
      />,
    );

    const banner = await screen.findByTestId("outcome-banner");
    expect(banner.getAttribute("data-outcome-state")).toBe("failed");
    expect(banner.getAttribute("data-outcome-reason")).toBe("auth_failure");
    expect(banner.getAttribute("data-outcome-cache-intact")).toBe("true");

    const postSnapshot = await snapshotPreRefreshState();
    expect(postSnapshot.projects).toEqual(preSnapshot.projects);
    expect(postSnapshot.tasks).toEqual(preSnapshot.tasks);

    const sessions = postSnapshot.sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.status).not.toBe("succeeded");
  });

  it("renders a distinct 'rate_limited' reason in OutcomeBanner and preserves the previous complete cache", async () => {
    installAsanaFailureOverride("rate_limited");
    const preSnapshot = await snapshotPreRefreshState();

    const result = await refreshOrchestrator.runRefresh({
      workspaceGid: WORKSPACE_GID,
      token: "test-token-value",
    });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.reason).toBe<RefreshFailureReason>("rate_limited");

    render(
      <OutcomeHarness
        workspaceGid={WORKSPACE_GID}
        injection="rate_limited"
        abortAfterFirstProjectsPage={false}
        outcomeToRender={result}
        onOutcomeRendered={() => undefined}
      />,
    );

    const banner = await screen.findByTestId("outcome-banner");
    expect(banner.getAttribute("data-outcome-state")).toBe("failed");
    expect(banner.getAttribute("data-outcome-reason")).toBe("rate_limited");
    expect(banner.getAttribute("data-outcome-cache-intact")).toBe("true");

    const postSnapshot = await snapshotPreRefreshState();
    expect(postSnapshot.projects).toEqual(preSnapshot.projects);
    expect(postSnapshot.tasks).toEqual(preSnapshot.tasks);

    const sessions = postSnapshot.sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.status).not.toBe("succeeded");
  });

  it("renders a distinct 'cancelled' reason in OutcomeBanner and preserves the previous complete cache", async () => {
    const preSnapshot = await snapshotPreRefreshState();

    const controller = new AbortController();
    // Abort on the next microtask so the orchestrator picks up the
    // signal mid-refresh (between the first projects page and the
    // first tasks page). The orchestrator is required to surface a
    // `cancelled` outcome rather than a `failed` outcome for the
    // user-cancel path; a future contributor who treats the abort
    // as a network error fails this test.
    queueMicrotask(() => controller.abort());

    const result = await refreshOrchestrator.runRefresh({
      workspaceGid: WORKSPACE_GID,
      token: "test-token-value",
      signal: controller.signal,
    });

    expect(result.status).toBe("cancelled");

    render(
      <OutcomeHarness
        workspaceGid={WORKSPACE_GID}
        injection="none"
        abortAfterFirstProjectsPage
        outcomeToRender={result}
        onOutcomeRendered={() => undefined}
      />,
    );

    const banner = await screen.findByTestId("outcome-banner");
    expect(banner.getAttribute("data-outcome-state")).toBe("cancelled");
    expect(banner.getAttribute("data-outcome-reason")).toBe("cancelled");
    expect(banner.getAttribute("data-outcome-cache-intact")).toBe("true");

    const postSnapshot = await snapshotPreRefreshState();
    expect(postSnapshot.projects).toEqual(preSnapshot.projects);
    expect(postSnapshot.tasks).toEqual(preSnapshot.tasks);
  });

  it("does NOT show the same reason for two different failure modes (distinct reasons)", async () => {
    // Distinctness guard — every failure mode surfaces its own reason
    // string in the banner, never a shared generic label like
    // "refresh failed" for both network and auth. The test runs the
    // orchestrator against three Asana-side failures (network / auth
    // / rate-limit) and asserts the banner reason strings are pairwise
    // different. The user-cancel case is a different `state` entirely
    // (cancelled vs failed) so it is asserted separately above.
    const observedReasons = new Set<string>();
    const injectionModes: Array<
      Exclude<FailureInjectionMode, "none" | "cancelled">
    > = ["network_error", "auth_failure", "rate_limited"];

    for (const mode of injectionModes) {
      // Re-seed the previous complete cache for each iteration so the
      // next scenario starts from the same byte-identical baseline.
      await clearAllStores();
      await seedPreRefreshState();
      installAsanaFailureOverride(mode);

      const result = await refreshOrchestrator.runRefresh({
        workspaceGid: WORKSPACE_GID,
        token: "test-token-value",
      });
      expect(result.status).toBe("failed");
      if (result.status !== "failed") {
        throw new Error(
          `Expected orchestrator to fail for mode ${mode} but got ${result.status}`,
        );
      }

      render(
        <OutcomeHarness
          workspaceGid={WORKSPACE_GID}
          injection={mode}
          abortAfterFirstProjectsPage={false}
          outcomeToRender={result}
          onOutcomeRendered={() => undefined}
        />,
      );

      const banner = await screen.findByTestId("outcome-banner");
      const reason = banner.getAttribute("data-outcome-reason");
      expect(reason).not.toBeNull();
      observedReasons.add(reason ?? "");
      cleanup();
    }

    expect(observedReasons.size).toBe(injectionModes.length);
  });
});
