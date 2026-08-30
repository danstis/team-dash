/**
 * BSOD-449 — Asana `gid` path-encoding contract test (Red→Green).
 *
 * The weekly security review (BSOD-448) found that `fetchTasksPage` and
 * `fetchTaskDetail` interpolate their `gid` argument into the request
 * path without `encodeURIComponent`, while `buildAsanaUrl`'s docstring
 * asserts the opposite ("callers `encodeURIComponent` interpolated
 * `gid`s before formatting"). A `gid` carrying URL-significant
 * characters could therefore:
 *
 * - `../../users/me` — retarget the request to a different Asana
 *   endpoint entirely (`new URL()` normalises `..` segments), issued
 *   with the user's bearer token.
 * - `123?opt_fields=` — truncate the path and override the `opt_fields`
 *   the wrapper appends.
 *
 * These `gid`s come from Asana API responses / the Dexie cache today, so
 * this is defence-in-depth rather than a live exploit — but the sink is
 * real and the documented invariant must be honoured.
 *
 * Red: with the un-encoded interpolation, `fetchTaskDetail(token,
 * "../../users/me")` hits `/api/1.0/users/me` and `fetchTasksPage(token,
 * "123?opt_fields=")` sends a caller-controlled query string.
 * Green: the wrappers `encodeURIComponent` each segment, the traversal
 * is neutralised, and the wrapper's own `opt_fields` value survives.
 */

import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "../setup";

import { fetchTaskDetail, fetchTasksPage } from "../../src/data/asana/client";

const token = "fixture-token";

const sampleTaskDetail = {
  gid: "1200000000000200",
  name: "Detailed task",
  resource_type: "task" as const,
  resource_subtype: "default_task" as const,
  created_at: "2026-07-01T09:00:00.000Z",
  modified_at: "2026-07-20T09:00:00.000Z",
  assignee: null,
  projects: [{ gid: "1200000000000100", resource_type: "project" as const }],
  parent: null,
};

describe("BSOD-449 Asana client path encoding", () => {
  describe("fetchTaskDetail", () => {
    it("neutralises a path-traversal `gid` instead of retargeting the request", async () => {
      let tasksHandlerHit = false;
      let usersMeHandlerHit = false;
      let observedPath: string | null = null;

      server.use(
        http.get(
          "https://app.asana.com/api/1.0/tasks/:taskGid",
          ({ request }) => {
            tasksHandlerHit = true;
            observedPath = new URL(request.url).pathname;
            return HttpResponse.json({ data: sampleTaskDetail });
          },
        ),
        http.get("https://app.asana.com/api/1.0/users/me", () => {
          usersMeHandlerHit = true;
          return HttpResponse.json({
            data: { gid: "1", name: "me", resource_type: "user" },
          });
        }),
      );

      await fetchTaskDetail(token, "../../users/me");

      expect(usersMeHandlerHit).toBe(false);
      expect(tasksHandlerHit).toBe(true);
      // The traversal segments must be percent-encoded so `new URL()`
      // cannot normalise them away.
      expect(observedPath).toBe("/api/1.0/tasks/..%2F..%2Fusers%2Fme");
    });
  });

  describe("fetchTasksPage", () => {
    it("keeps a query-injecting `gid` inside its path segment", async () => {
      let observedUrl: URL | null = null;

      server.use(
        http.get(
          "https://app.asana.com/api/1.0/projects/:projectGid/tasks",
          ({ request }) => {
            observedUrl = new URL(request.url);
            return HttpResponse.json({ data: [], next_page: null });
          },
        ),
      );

      const result = await fetchTasksPage(token, "123?opt_fields=");

      expect(result.outcome).toBe("ok");
      expect(observedUrl).not.toBeNull();
      const url = observedUrl as unknown as URL;

      // The `?` must not have started a query string in the path.
      expect(url.pathname).toBe("/api/1.0/projects/123%3Fopt_fields%3D/tasks");
      // The wrapper's own `opt_fields` value is the only one present and
      // is non-empty — the caller could not blank it out.
      expect(url.searchParams.getAll("opt_fields")).toHaveLength(1);
      expect(url.searchParams.get("opt_fields")).toBeTruthy();
    });
  });
});
