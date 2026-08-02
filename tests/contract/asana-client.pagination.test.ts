/**
 * T048 — Asana client pagination + events-since red→green contract test.
 *
 * This is the Red half of T048's Red/Green/Refactor (Constitution Principle
 * III). Per `specs/001-asana-team-dashboard/contracts/asana-client.md` and
 * the task row's acceptance criteria, this file MUST fail for the intended
 * reason (the four new exports — `fetchProjectsPage`, `fetchTasksPage`,
 * `fetchTaskDetail`, `fetchEventsSince` — do not yet exist in
 * `src/data/asana/client.ts`) and MUST pass once the implementation lands.
 *
 * What this file asserts (verbatim from the contract and the T048 row):
 *
 * 1. **`fetchProjectsPage` pagination walk** — the function accepts an
 *    opaque `nextPageOffset` token (per FR-021) and returns the response's
 *    `next_page` on the `ok.data` variant unchanged. The client itself is
 *    stateless and does NOT loop internally — the refresh orchestrator
 *    (T051) drives the loop and terminates when the response's
 *    `next_page` is `null`. A test-verifiable scenario walks three pages
 *    via the orchestrator's "increment offset until null" pattern and
 *    asserts the concatenated result equals the fixture's flat list.
 *
 * 2. **`fetchTasksPage` pagination walk** — same shape as projects but
 *    scoped to a single project (`GET /projects/{gid}/tasks?offset=…`).
 *    The fixture's `/projects/:gid/tasks` handler is paginated across two
 *    pages in this test.
 *
 * 3. **`fetchTaskDetail` single-task lookup** — `GET /tasks/{gid}` for a
 *    known fixture task returns the parsed task envelope (the task, not a
 *    `{ data, next_page }` wrapper).
 *
 * 4. **`fetchEventsSince` stale/invalid-state contract**:
 *
 *    - **Validation error** — the response body fails Zod validation
 *      (e.g. `events` is missing or is not an array); the function
 *      returns `outcome: 'validation_error'` with structured `ZodIssue[]`
 *      (FR-081/FR-082/FR-083). This is the FR-024 "stale/invalid
 *      incremental state ⇒ full reconciliation" trigger.
 *
 *    - **`412 Precondition Failed`** — Asana's documented "sync token
 *      expired" status (FR-024); the function MUST surface it as
 *      `outcome: 'permission_failure'` so the orchestrator falls back to
 *      a full refresh. This is the test that proves 412 is NOT a
 *      generic `network_error`.
 *
 *    - **No prior sync token** — per the FR-024 fallback list and the
 *      task row ("no prior sync token"), the function MUST return
 *      `outcome: 'validation_error'` with a structured ZodIssue when the
 *      caller passes no sync token. (An empty-string `syncToken` is
 *      treated the same as missing.) This is the API-surface half of the
 *      "absence of any previously stored sync token for the current
 *      workspace ⇒ full reconciliation" rule — the storage-half lives
 *      in the orchestrator (T051) and data-model.md.
 *
 * The read-only guarantee is verified separately by
 * `tests/contract/asana-client.readonly.test.ts` (T026); that test scans
 * the module's exports for any write-method-shaped name and asserts the
 * new exports match the contract's read-only surface.
 */

import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { server } from "../setup";

import {
  fetchEventsSince,
  fetchProjectsPage,
  fetchTaskDetail,
  fetchTasksPage,
} from "../../src/data/asana/client";
import type {
  asanaProjectSchema,
  asanaTaskSchema,
} from "../../src/data/asana/schemas";

const token = "fixture-token";
const workspaceGid = "1200000000000001";
const projectGid = "1200000000000100";
const taskGid = "1200000000000200";

/**
 * Local fixture payloads the handlers below return. Kept inline (rather
 * than sharing with `asana-client.auth.test.ts` or the small-dataset
 * fixture) so a reader can read this file top-to-bottom without
 * cross-file grep, and so the test is self-contained against its own
 * MSW handlers — the per-test handlers override the canonical
 * small-dataset handlers just for these cases.
 *
 * Fixtures are typed as the corresponding Zod-inferred resource schema
 * rather than `as const`-typed object literals, so the inferred type
 * matches the runtime shape the client parses into and assignment
 * to/from the `AsanaClientResult` data variants is structural rather
 * than a hand-narrowed literal.
 */
type ProjectFixture = z.infer<typeof asanaProjectSchema>;
type TaskFixture = z.infer<typeof asanaTaskSchema>;

const sampleProjectA: ProjectFixture = {
  gid: "1200000000000900",
  name: "Sample Project A",
  resource_type: "project",
  archived: false,
  workspace: { gid: workspaceGid, resource_type: "workspace" },
};

const sampleProjectB: ProjectFixture = {
  gid: "1200000000000901",
  name: "Sample Project B",
  resource_type: "project",
  archived: false,
  workspace: { gid: workspaceGid, resource_type: "workspace" },
};

const sampleTaskOne: TaskFixture = {
  gid: "1200000000000902",
  name: "Paginated task one",
  resource_type: "task",
  resource_subtype: "default_task",
  created_at: "2026-07-20T09:00:00.000Z",
  modified_at: "2026-07-21T09:00:00.000Z",
  assignee: null,
  projects: [{ gid: projectGid, resource_type: "project" }],
  parent: null,
};

const sampleTaskTwo: TaskFixture = {
  gid: "1200000000000903",
  name: "Paginated task two",
  resource_type: "task",
  resource_subtype: "default_task",
  created_at: "2026-07-21T09:00:00.000Z",
  modified_at: "2026-07-22T09:00:00.000Z",
  assignee: null,
  projects: [{ gid: projectGid, resource_type: "project" }],
  parent: null,
};

const sampleTaskDetail: TaskFixture = {
  gid: taskGid,
  name: "Detailed task",
  resource_type: "task",
  resource_subtype: "default_task",
  created_at: "2026-07-01T09:00:00.000Z",
  modified_at: "2026-07-20T09:00:00.000Z",
  assignee: {
    gid: "1200000000000020",
    name: "Alex Kim",
    resource_type: "user",
  },
  projects: [{ gid: projectGid, resource_type: "project" }],
  parent: null,
};

describe("T048 Asana client pagination + events-since contract", () => {
  describe("fetchProjectsPage", () => {
    it("returns the first page and the opaque next-page offset on a non-final response", async () => {
      server.use(
        http.get("https://app.asana.com/api/1.0/projects", ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("workspace")).toBe(workspaceGid);
          expect(url.searchParams.get("archived")).toBe("false");
          return HttpResponse.json({
            data: [sampleProjectA],
            next_page: {
              offset: "opaque-offset-1",
              path: "/projects",
            },
          });
        }),
      );

      const result = await fetchProjectsPage(token, workspaceGid);

      expect(result.outcome).toBe("ok");
      if (result.outcome !== "ok") return;
      expect(result.data.data).toEqual([sampleProjectA]);
      expect(result.data.next_page).toEqual({
        offset: "opaque-offset-1",
        path: "/projects",
      });
    });

    it("completes a multi-page walk by following next_page.offset until null", async () => {
      // Three pages: page 1 returns [A] + nextPageOffset; page 2 returns
      // [B] + nextPageOffset; page 3 returns [C] + next_page: null. A
      // contract-correct orchestrator (T051) walks until null and
      // concatenates the flattened page contents.
      const observedOffsets: Array<string | null> = [];
      server.use(
        http.get("https://app.asana.com/api/1.0/projects", ({ request }) => {
          const url = new URL(request.url);
          const offset = url.searchParams.get("offset");
          observedOffsets.push(offset);
          if (offset === null) {
            return HttpResponse.json({
              data: [sampleProjectA],
              next_page: {
                offset: "opaque-offset-1",
                path: "/projects",
              },
            });
          }
          if (offset === "opaque-offset-1") {
            return HttpResponse.json({
              data: [sampleProjectB],
              next_page: {
                offset: "opaque-offset-2",
                path: "/projects",
              },
            });
          }
          if (offset === "opaque-offset-2") {
            return HttpResponse.json({
              data: [
                {
                  ...sampleProjectA,
                  gid: "1200000000000902",
                  name: "Sample Project C",
                },
              ],
              next_page: null,
            });
          }
          return HttpResponse.json({ data: [], next_page: null });
        }),
      );

      // The orchestrator's paging loop, modelled inline so the test pins
      // the contract: call `fetchProjectsPage` with the previous page's
      // `next_page.offset` until null, flatten the per-page arrays.
      const collected: (typeof sampleProjectA)[] = [];
      let cursor: string | undefined = undefined;
      let iterations = 0;
      while (true) {
        iterations += 1;
        if (iterations > 10) {
          throw new Error(
            "pagination loop did not terminate within 10 iterations",
          );
        }
        const pageResult = await fetchProjectsPage(
          token,
          workspaceGid,
          cursor === undefined ? undefined : { offset: cursor },
        );
        if (pageResult.outcome !== "ok") {
          throw new Error(
            `unexpected outcome during pagination walk: ${pageResult.outcome}`,
          );
        }
        collected.push(...pageResult.data.data);
        const nextPage = pageResult.data.next_page;
        if (nextPage === null) {
          break;
        }
        cursor = nextPage.offset;
      }

      expect(collected).toEqual([
        sampleProjectA,
        sampleProjectB,
        {
          ...sampleProjectA,
          gid: "1200000000000902",
          name: "Sample Project C",
        },
      ]);
      // The orchestrator walked three pages — exactly the three the
      // fixture emits — and stopped on the first null `next_page`.
      expect(iterations).toBe(3);
      expect(observedOffsets).toEqual([
        null,
        "opaque-offset-1",
        "opaque-offset-2",
      ]);
    });

    it("passes `archived=false` explicitly per FR-012 so archived projects are excluded at the server", async () => {
      let observedArchived: string | null = null;
      server.use(
        http.get("https://app.asana.com/api/1.0/projects", ({ request }) => {
          observedArchived = new URL(request.url).searchParams.get("archived");
          return HttpResponse.json({ data: [], next_page: null });
        }),
      );

      await fetchProjectsPage(token, workspaceGid);

      expect(observedArchived).toBe("false");
    });

    it("forwards the supplied offset verbatim to the server", async () => {
      let observedOffset: string | null = null;
      server.use(
        http.get("https://app.asana.com/api/1.0/projects", ({ request }) => {
          observedOffset = new URL(request.url).searchParams.get("offset");
          return HttpResponse.json({ data: [], next_page: null });
        }),
      );

      await fetchProjectsPage(token, workspaceGid, {
        offset: "verbatim-offset-token",
      });

      expect(observedOffset).toBe("verbatim-offset-token");
    });

    it("returns `validation_error` when the projects response body fails schema validation", async () => {
      server.use(
        http.get("https://app.asana.com/api/1.0/projects", () =>
          // `archived` is missing — the project schema requires it (FR-012).
          HttpResponse.json({
            data: [{ gid: "1", name: "x", resource_type: "project" }],
            next_page: null,
          }),
        ),
      );

      const result = await fetchProjectsPage(token, workspaceGid);

      expect(result.outcome).toBe("validation_error");
      if (result.outcome !== "validation_error") return;
      expect(Array.isArray(result.issues)).toBe(true);
      expect(result.issues.length).toBeGreaterThan(0);
    });
  });

  describe("fetchTasksPage", () => {
    it("returns a tasks page scoped to the supplied project gid", async () => {
      let observedProjectGid: string | null = null;
      server.use(
        http.get(
          "https://app.asana.com/api/1.0/projects/:projectGid/tasks",
          ({ params, request }) => {
            observedProjectGid = String(params.projectGid);
            const url = new URL(request.url);
            expect(url.searchParams.get("opt_fields")).toBeTruthy();
            return HttpResponse.json({
              data: [sampleTaskOne],
              next_page: {
                offset: "tasks-offset-1",
                path: `/projects/${observedProjectGid}/tasks`,
              },
            });
          },
        ),
      );

      const result = await fetchTasksPage(token, projectGid);

      expect(observedProjectGid).toBe(projectGid);
      expect(result.outcome).toBe("ok");
      if (result.outcome !== "ok") return;
      expect(result.data.data).toEqual([sampleTaskOne]);
      expect(result.data.next_page?.offset).toBe("tasks-offset-1");
    });

    it("completes a multi-page task walk by following next_page.offset until null", async () => {
      const observedOffsets: Array<string | null> = [];
      server.use(
        http.get(
          "https://app.asana.com/api/1.0/projects/:projectGid/tasks",
          ({ request }) => {
            const url = new URL(request.url);
            const offset = url.searchParams.get("offset");
            observedOffsets.push(offset);
            if (offset === null) {
              return HttpResponse.json({
                data: [sampleTaskOne],
                next_page: {
                  offset: "tasks-offset-1",
                  path: `/projects/${projectGid}/tasks`,
                },
              });
            }
            if (offset === "tasks-offset-1") {
              return HttpResponse.json({
                data: [sampleTaskTwo],
                next_page: null,
              });
            }
            return HttpResponse.json({ data: [], next_page: null });
          },
        ),
      );

      const collected: (typeof sampleTaskOne)[] = [];
      let cursor: string | undefined = undefined;
      let iterations = 0;
      while (true) {
        iterations += 1;
        if (iterations > 10) {
          throw new Error(
            "tasks pagination loop did not terminate within 10 iterations",
          );
        }
        const pageResult = await fetchTasksPage(
          token,
          projectGid,
          cursor === undefined ? undefined : { offset: cursor },
        );
        if (pageResult.outcome !== "ok") {
          throw new Error(
            `unexpected outcome during task pagination walk: ${pageResult.outcome}`,
          );
        }
        collected.push(...pageResult.data.data);
        const nextPage = pageResult.data.next_page;
        if (nextPage === null) {
          break;
        }
        cursor = nextPage.offset;
      }

      expect(collected).toEqual([sampleTaskOne, sampleTaskTwo]);
      expect(iterations).toBe(2);
      expect(observedOffsets).toEqual([null, "tasks-offset-1"]);
    });

    it("returns `validation_error` when the tasks response body fails schema validation", async () => {
      server.use(
        http.get(
          "https://app.asana.com/api/1.0/projects/:projectGid/tasks",
          () =>
            // Missing required fields — `created_at`/`modified_at` are
            // required by `asanaTaskSchema`. Triggers a ZodIssue.
            HttpResponse.json({
              data: [
                {
                  gid: "1",
                  name: "x",
                  resource_type: "task",
                  resource_subtype: "default_task",
                },
              ],
              next_page: null,
            }),
        ),
      );

      const result = await fetchTasksPage(token, projectGid);

      expect(result.outcome).toBe("validation_error");
      if (result.outcome !== "validation_error") return;
      expect(result.issues.length).toBeGreaterThan(0);
    });
  });

  describe("fetchTaskDetail", () => {
    it("returns the single parsed task on success", async () => {
      let observedTaskGid: string | null = null;
      let observedUrl: string | null = null;
      server.use(
        http.get(
          "https://app.asana.com/api/1.0/tasks/:taskGid",
          ({ params, request }) => {
            observedTaskGid = String(params.taskGid);
            observedUrl = request.url;
            return HttpResponse.json({ data: sampleTaskDetail });
          },
        ),
      );

      const result = await fetchTaskDetail(token, taskGid);

      expect(observedTaskGid).toBe(taskGid);
      // The credential must travel only in the `Authorization` header,
      // never in the URL — the contract's "URL/log safety" rule (FR-008,
      // FR-010).
      expect(observedUrl).not.toContain(token);
      expect(result.outcome).toBe("ok");
      if (result.outcome !== "ok") return;
      expect(result.data.gid).toBe(taskGid);
      expect(result.data.name).toBe("Detailed task");
    });

    it("returns `validation_error` when the task detail response fails Zod validation", async () => {
      server.use(
        http.get("https://app.asana.com/api/1.0/tasks/:taskGid", () =>
          // Missing required `created_at`/`modified_at`.
          HttpResponse.json({
            data: {
              gid: taskGid,
              name: "Broken task",
              resource_type: "task",
              resource_subtype: "default_task",
            },
          }),
        ),
      );

      const result = await fetchTaskDetail(token, taskGid);

      expect(result.outcome).toBe("validation_error");
      if (result.outcome !== "validation_error") return;
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it("maps an unknown task to `network_error` (4xx transport-level failure)", async () => {
      server.use(
        http.get(
          "https://app.asana.com/api/1.0/tasks/:taskGid",
          () => new HttpResponse(null, { status: 404 }),
        ),
      );

      const result = await fetchTaskDetail(token, "0000000000000999");

      expect(result.outcome).toBe("network_error");
    });
  });

  describe("fetchEventsSince", () => {
    it("returns `ok` with the events batch and new sync token on a successful response", async () => {
      let observedResourceGid: string | null = null;
      let observedSyncToken: string | null = null;
      server.use(
        http.get("https://app.asana.com/api/1.0/events", ({ request }) => {
          const url = new URL(request.url);
          observedResourceGid = url.searchParams.get("resource");
          observedSyncToken = url.searchParams.get("sync");
          return HttpResponse.json({
            data: [
              {
                action: "changed",
                resource: { gid: taskGid, resource_type: "task" },
              },
            ],
            sync: "new-sync-token-from-server",
            has_more: false,
          });
        }),
      );

      const result = await fetchEventsSince(
        token,
        projectGid,
        "previous-sync-token",
      );

      expect(observedResourceGid).toBe(projectGid);
      expect(observedSyncToken).toBe("previous-sync-token");
      expect(result.outcome).toBe("ok");
      if (result.outcome !== "ok") return;
      expect(result.data.events).toEqual([
        {
          action: "changed",
          resource: { gid: taskGid, resource_type: "task" },
        },
      ]);
      expect(result.data.newSyncToken).toBe("new-sync-token-from-server");
      expect(result.data.hasMore).toBe(false);
    });

    it("preserves Asana's `has_more` signal so callers can keep pulling event batches until completion", async () => {
      server.use(
        http.get("https://app.asana.com/api/1.0/events", () =>
          HttpResponse.json({
            data: [
              {
                action: "changed",
                resource: { gid: taskGid, resource_type: "task" },
              },
            ],
            sync: "rolled-forward-sync-token",
            has_more: true,
          }),
        ),
      );

      const result = await fetchEventsSince(
        token,
        projectGid,
        "previous-sync-token",
      );

      expect(result.outcome).toBe("ok");
      if (result.outcome !== "ok") return;
      expect(result.data.newSyncToken).toBe("rolled-forward-sync-token");
      expect(result.data.hasMore).toBe(true);
    });

    it("returns `validation_error` with structured ZodIssue[] when the events response body fails schema validation (FR-024 stale/invalid state)", async () => {
      server.use(
        http.get("https://app.asana.com/api/1.0/events", () =>
          // The events response must include `data` (the events array)
          // and `sync` (the new sync token); absent/empty `data` is the
          // shape that breaks the schema.
          HttpResponse.json({ not_a_valid_event_payload: true }),
        ),
      );

      const result = await fetchEventsSince(
        token,
        projectGid,
        "previous-sync-token",
      );

      expect(result.outcome).toBe("validation_error");
      if (result.outcome !== "validation_error") return;
      expect(Array.isArray(result.issues)).toBe(true);
      expect(result.issues.length).toBeGreaterThan(0);
      // Each issue MUST carry a code/path/message — that's what the
      // FR-084 data-quality panel surfaces.
      for (const issue of result.issues) {
        expect(typeof issue.code).toBe("string");
        expect(Array.isArray(issue.path)).toBe(true);
        expect(typeof issue.message).toBe("string");
      }
    });

    it("returns `permission_failure` on 412 Precondition Failed (FR-024 expired sync token)", async () => {
      let observedResourceGid: string | null = null;
      let observedSyncToken: string | null = null;
      server.use(
        http.get("https://app.asana.com/api/1.0/events", ({ request }) => {
          const url = new URL(request.url);
          observedResourceGid = url.searchParams.get("resource");
          observedSyncToken = url.searchParams.get("sync");
          return new HttpResponse(null, { status: 412 });
        }),
      );

      const result = await fetchEventsSince(
        token,
        projectGid,
        "expired-sync-token",
      );

      // The 412 must reach the orchestrator as `permission_failure`,
      // not as the generic `network_error` the base client uses for
      // unknown statuses — the orchestrator's full-reconciliation
      // fallback (T051) triggers on this specific outcome per FR-024.
      expect(observedResourceGid).toBe(projectGid);
      expect(observedSyncToken).toBe("expired-sync-token");
      expect(result.outcome).toBe("permission_failure");
    });

    it("returns `validation_error` when no resource gid is supplied", async () => {
      const result = await fetchEventsSince(token, undefined, "sync-token");

      expect(result.outcome).toBe("validation_error");
      if (result.outcome !== "validation_error") return;
      const mentionsResource = result.issues.some((issue) =>
        JSON.stringify(issue.path).toLowerCase().includes("resource"),
      );
      expect(mentionsResource).toBe(true);
    });

    it("returns `validation_error` when the supplied resource gid is empty", async () => {
      const result = await fetchEventsSince(token, "", "sync-token");

      expect(result.outcome).toBe("validation_error");
      if (result.outcome !== "validation_error") return;
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it("returns `validation_error` with a structured ZodIssue when no sync token is supplied (no prior sync token stored for the workspace)", async () => {
      const result = await fetchEventsSince(token, projectGid);

      expect(result.outcome).toBe("validation_error");
      if (result.outcome !== "validation_error") return;
      expect(Array.isArray(result.issues)).toBe(true);
      expect(result.issues.length).toBeGreaterThan(0);
      // The path MUST point at the sync-token field so the FR-084
      // data-quality panel can attribute the gap to "no prior sync
      // token" rather than a generic Asana-side wire change.
      const mentionsSync = result.issues.some((issue) =>
        JSON.stringify(issue.path).toLowerCase().includes("sync"),
      );
      expect(mentionsSync).toBe(true);
    });

    it("returns `validation_error` with a structured ZodIssue when the supplied sync token is empty", async () => {
      const result = await fetchEventsSince(token, projectGid, "");

      expect(result.outcome).toBe("validation_error");
      if (result.outcome !== "validation_error") return;
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it("does not issue a request when the sync token is missing — the `no prior sync token` case is detected client-side before network I/O", async () => {
      let requestIssued = false;
      server.use(
        http.get("https://app.asana.com/api/1.0/events", () => {
          requestIssued = true;
          return HttpResponse.json({ data: [], sync: "x" });
        }),
      );

      const result = await fetchEventsSince(token, projectGid);

      // No HTTP request should have been issued — the missing-token
      // case is caught at the function boundary (saving a round trip
      // the orchestrator would otherwise need to wait on, and
      // guaranteed to never reach a real Asana server with a half-
      // constructed request). This also confirms the URL `/events`
      // path is reserved for the `syncToken`-supplied case.
      expect(requestIssued).toBe(false);
      expect(result.outcome).toBe("validation_error");
    });

    it("does not issue a request when the resource gid is missing — the scope check happens before network I/O", async () => {
      let requestIssued = false;
      server.use(
        http.get("https://app.asana.com/api/1.0/events", () => {
          requestIssued = true;
          return HttpResponse.json({ data: [], sync: "x", has_more: false });
        }),
      );

      const result = await fetchEventsSince(token, undefined, "sync-token");

      expect(requestIssued).toBe(false);
      expect(result.outcome).toBe("validation_error");
    });

    it("returns `auth_failure` on 401 without exposing the sync token in the result payload", async () => {
      server.use(
        http.get(
          "https://app.asana.com/api/1.0/events",
          () => new HttpResponse(null, { status: 401 }),
        ),
      );

      const result = await fetchEventsSince(
        token,
        projectGid,
        "sensitive-sync-token",
      );

      expect(result.outcome).toBe("auth_failure");
      // The auth_failure variant carries no payload per `types.ts`;
      // confirms the contract that a 401 body cannot echo credentials.
      if (result.outcome === "auth_failure") {
        expect(Object.keys(result)).toEqual(["outcome"]);
      }
    });
  });
});
