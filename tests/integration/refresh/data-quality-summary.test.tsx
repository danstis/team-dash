/**
 * BSOD-311 (T064) — FR-084 data-quality summary red→green.
 *
 * Spec / contract references
 * --------------------------
 * FR-084 (spec.md:366):
 *
 *   "FR-084: The system MUST provide a visible summary of
 *    data-completeness issues discovered during the most recent refresh
 *    (e.g., counts of tasks with missing/malformed Priority) so the
 *    user can judge how much to trust affected metrics."
 *
 * FR-081 / FR-082 / FR-083 (spec.md:363-365) are the rules this
 * summary makes countable: a missing or malformed Priority is FLAGGED
 * rather than silently treated as an absent value, and a missing or
 * malformed value is never converted into a favourable state. The
 * summary is where those flags become a number the user can read.
 *
 * `data-model.md:234-241` — `DataQualityFlag`:
 *
 *   - `kind: 'missing_assignee' | 'missing_estimate' |
 *     'missing_priority' | 'malformed_priority' | 'missing_due_date' |
 *     'missing_actual_time'`
 *   - `taskGids: string[]`
 *   - `count: number`
 *
 *   "Feeds both the FR-084 refresh-summary panel and the FR-079 P2
 *    data-quality-indicators metric from the same underlying scan."
 *
 * So the FR-084 surface consumes `DataQualityFlag[]` — the same scan
 * that feeds the per-metric panel — and renders the COUNTS (and the
 * drill-down set behind each count) the user needs in order to judge
 * the affected metrics.
 *
 * What this test pins
 * -------------------
 *
 * 1. The counts of the `validation_error` issues the most recent
 *    refresh reported are surfaced. The test drives the REAL Asana
 *    client against an MSW handler that returns a task payload whose
 *    `Priority` custom field is malformed, so the client classifies
 *    the page as `outcome: 'validation_error'` and carries the
 *    structured `ZodIssue[]`. The summary then renders the number of
 *    those issues — the count is the refresh's finding, not a
 *    hand-written fixture number.
 *
 * 2. Every kind of data-completeness finding gets its own count, and
 *    the total across the kinds is the number of findings the refresh
 *    surfaced. A finding with a zero count is not rendered (there is
 *    nothing to disclose about it).
 *
 * 3. The zero state is honest: when the most recent refresh found no
 *    data-completeness issues, the summary says exactly that — it does
 *    NOT claim the data is complete in every respect, and it does not
 *    render an empty list.
 *
 * 4. Every count stays TRACEABLE to the tasks it affects. The
 *    `DataQualityFlag.taskGids` set is the drill-down path (Principle
 *    II: "the interface MUST let an authorised user understand why a
 *    given task was included or excluded from a metric"), so the
 *    summary hands the whole flag back to the caller when the user
 *    activates a row.
 *
 * 5. The summary is NOT a composite score. The constitution forbids
 *    "hidden or unexplained composite performance scores"; the
 *    summary discloses counts and the affected tasks, and nothing
 *    else.
 *
 * Out of scope (other rows, NOT exercised here)
 * ---------------------------------------------
 * - The per-metric `DataQualityPanel` (T112 / BSOD-343 and T113 /
 *   BSOD-344, FR-079). That surface is the METRIC view of the same
 *   scan; this row ships the post-refresh summary.
 * - `calculateDataQuality` (T112 / BSOD-343) — the production scan
 *   that walks the refreshed tasks and attributes each completeness
 *   finding to a task gid. It is a US10 row and is not implemented
 *   yet; the helper below stands in for it so this test can drive
 *   the surface from a REAL `validation_error` outcome.
 * - The dashboard chrome that decides WHEN the summary is mounted.
 *   This row ships the surface.
 *
 * Test-first discipline
 * ----------------------
 * Per Constitution Principle III this file lands with the failing
 * test first: the Red phase fails with "Cannot find module
 * '../../../src/features/refresh/DataQualitySummary'", and the same
 * file goes green once `DataQualitySummary` implements the surface —
 * with no test-side change.
 *
 * Boundary
 * --------
 * `tests/integration/**` runs against jsdom + `fake-indexeddb` + MSW
 * per `tests/setup.ts`. No browser, no live Asana workspace, no real
 * personal access token (Principle III, NFR-005). The fixture PAT is
 * synthetic and the MSW handlers authorise any `Authorization: Bearer
 * …` request.
 */
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import type { ZodIssue } from "zod";

import { fetchTasksPage } from "../../../src/data/asana/client";
import type { DataQualityFlag } from "../../../src/domain/types";
import { DataQualitySummary } from "../../../src/features/refresh/DataQualitySummary";
import { server } from "../../setup";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A synthetic, non-secret bearer value. The MSW fixture handlers
 * authorise any `Authorization: Bearer …` request, so the string only
 * has to be shaped like a token — it is not a credential and grants no
 * access anywhere (Principle IV: no real token ever enters a fixture).
 */
const FIXTURE_TOKEN = "fixture-data-quality-summary-token-1234567890";

/**
 * The project whose task page the fixture overrides. The gid is the
 * small-dataset fixture's own project gid — a synthetic value from
 * `fixtures/asana/small-dataset/data.ts`.
 */
const PROJECT_GID = "1200000000000100";

/**
 * A task whose `Priority` custom field carries a malformed option.
 *
 * The wire schema requires a custom-field option's `gid` to match
 * `/^[A-Za-z0-9_-]+$/` (`asanaCustomFieldEnumOptionSchema`), so the
 * spaced-and-banged gid below fails the Zod boundary and surfaces as
 * a `validation_error` issue. That is exactly the FR-081 / FR-082
 * "malformed Priority" case the FR-084 summary must count.
 */
function taskWithMalformedPriority(gid: string, name: string) {
  return {
    gid,
    name,
    resource_type: "task",
    resource_subtype: "default_task",
    created_at: "2026-07-05T09:00:00.000Z",
    modified_at: "2026-07-21T09:00:00.000Z",
    completed: false,
    custom_fields: [
      {
        gid: "1200000000009001",
        name: "Priority",
        type: "enum",
        resource_subtype: "enum",
        enum_value: { gid: "not a valid gid!", name: "Critical" },
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Attribute the client's `validation_error` issues to the
 * `DataQualityFlag`s the FR-084 summary renders.
 *
 * The production scan that walks the refreshed tasks and attributes
 * each completeness finding to a task gid is T112's
 * `calculateDataQuality` (US10) — not implemented in this row. This
 * helper stands in for it: the fixture's only schema violation is a
 * malformed `Priority` custom field, so every issue belongs to the
 * `malformed_priority` kind, and the issue's `data` index points at
 * the offending task in the fixture array.
 */
function flagsFromValidationIssues(
  issues: readonly ZodIssue[],
  taskGidsByIndex: readonly string[],
): DataQualityFlag[] {
  const gids: string[] = [];
  for (const issue of issues) {
    const index = issue.path[1];
    if (typeof index !== "number") {
      continue;
    }
    const gid = taskGidsByIndex[index];
    if (gid !== undefined) {
      gids.push(gid);
    }
  }
  return [{ kind: "malformed_priority", taskGids: gids, count: gids.length }];
}

/**
 * The summary as the dashboard chrome would compose it. The helper
 * keeps the per-test bodies focused on the assertions.
 */
function renderSummary(props: {
  readonly flags: readonly DataQualityFlag[];
  readonly onSelectFlag?: (flag: DataQualityFlag) => void;
}): void {
  render(
    <StrictMode>
      <DataQualitySummary
        flags={props.flags}
        onSelectFlag={props.onSelectFlag}
      />
    </StrictMode>,
  );
}

/* -------------------------------------------------------------------------- */
/* The counts                                                                  */
/* -------------------------------------------------------------------------- */

describe("BSOD-311 (T064) — FR-084 data-quality summary", () => {
  afterEach(() => {
    cleanup();
  });

  it("surfaces the count of validation issues the most recent refresh reported", async () => {
    server.use(
      http.get("https://app.asana.com/api/1.0/projects/:projectGid/tasks", () =>
        HttpResponse.json({
          data: [
            taskWithMalformedPriority("1200000000000200", "Launch dashboard"),
            taskWithMalformedPriority(
              "1200000000000201",
              "Ship the refresh summary",
            ),
          ],
          next_page: null,
        }),
      ),
    );

    const result = await fetchTasksPage(FIXTURE_TOKEN, PROJECT_GID);

    // The payload violates the task schema, so the Asana client
    // classifies the page as a `validation_error` and carries the
    // structured issues — the findings the FR-084 summary counts.
    expect(result.outcome).toBe("validation_error");
    if (result.outcome !== "validation_error") {
      return;
    }
    expect(result.issues).toHaveLength(2);

    renderSummary({
      flags: flagsFromValidationIssues(result.issues, [
        "1200000000000200",
        "1200000000000201",
      ]),
    });

    const summary = screen.getByTestId("data-quality-summary");
    expect(summary.getAttribute("data-issue-total")).toBe("2");
    expect(screen.getByTestId("data-quality-summary-total")).toHaveTextContent(
      /2 data-completeness issues/i,
    );

    const row = screen.getByTestId("data-quality-flag");
    expect(row.getAttribute("data-flag-kind")).toBe("malformed_priority");
    expect(row.getAttribute("data-flag-count")).toBe("2");
    expect(row).toHaveTextContent(/malformed priority/i);
    expect(row).toHaveTextContent(/2 tasks/i);
  });

  it("surfaces a count for every kind of data-completeness issue", () => {
    renderSummary({
      flags: [
        { kind: "missing_assignee", taskGids: ["task-a"], count: 1 },
        { kind: "missing_estimate", taskGids: ["task-b", "task-c"], count: 2 },
        { kind: "missing_priority", taskGids: ["task-d"], count: 1 },
        {
          kind: "malformed_priority",
          taskGids: ["task-e", "task-f"],
          count: 2,
        },
        // A finding with no affected tasks discloses nothing, so it is
        // not rendered.
        { kind: "missing_due_date", taskGids: [], count: 0 },
        { kind: "missing_actual_time", taskGids: ["task-g"], count: 1 },
      ],
    });

    const rows = screen.getAllByTestId("data-quality-flag");
    expect(rows).toHaveLength(5);

    const byKind = new Map(
      rows.map((row) => [
        row.getAttribute("data-flag-kind"),
        row.getAttribute("data-flag-count"),
      ]),
    );
    expect(byKind.get("missing_assignee")).toBe("1");
    expect(byKind.get("missing_estimate")).toBe("2");
    expect(byKind.get("missing_priority")).toBe("1");
    expect(byKind.get("malformed_priority")).toBe("2");
    expect(byKind.get("missing_actual_time")).toBe("1");
    expect(byKind.has("missing_due_date")).toBe(false);

    // The total is the number of findings the refresh surfaced across
    // every kind (1 + 2 + 1 + 2 + 1).
    expect(
      screen
        .getByTestId("data-quality-summary")
        .getAttribute("data-issue-total"),
    ).toBe("7");
    expect(screen.getByTestId("data-quality-summary-total")).toHaveTextContent(
      /7 data-completeness issues/i,
    );
  });

  it("says so plainly when the most recent refresh found no data-completeness issues", () => {
    renderSummary({ flags: [] });

    const summary = screen.getByTestId("data-quality-summary");
    expect(summary.getAttribute("data-issue-total")).toBe("0");
    expect(screen.getByTestId("data-quality-summary-total")).toHaveTextContent(
      /no data-completeness issues were found in the most recent refresh/i,
    );
    expect(screen.queryByTestId("data-quality-flag-list")).toBeNull();
  });

  it("keeps every count traceable to the tasks it affects", () => {
    const selected: DataQualityFlag[] = [];

    renderSummary({
      flags: [
        { kind: "missing_assignee", taskGids: ["task-a"], count: 1 },
        {
          kind: "malformed_priority",
          taskGids: ["task-e", "task-f"],
          count: 2,
        },
      ],
      onSelectFlag: (flag: DataQualityFlag) => {
        selected.push(flag);
      },
    });

    const rows = screen.getAllByTestId("data-quality-flag");
    expect(rows[0]?.getAttribute("data-drilldown-count")).toBe("1");
    expect(rows[1]?.getAttribute("data-drilldown-count")).toBe("2");

    fireEvent.click(screen.getAllByTestId("data-quality-flag-button")[1] ?? "");

    // The whole flag — kind, count and the task gids behind it — is
    // handed back, so the caller can drill down to the affected tasks
    // (Principle II's traceability rule).
    expect(selected).toHaveLength(1);
    expect(selected[0]?.kind).toBe("malformed_priority");
    expect(selected[0]?.count).toBe(2);
    expect(selected[0]?.taskGids).toEqual(["task-e", "task-f"]);
  });

  it("does not publish a composite quality score", () => {
    renderSummary({
      flags: [
        { kind: "missing_priority", taskGids: ["task-a", "task-b"], count: 2 },
      ],
    });

    // The constitution forbids hidden or unexplained composite
    // performance scores. The summary discloses counts and the tasks
    // behind them — never a percentage or a grade.
    expect(screen.getByTestId("data-quality-summary")).not.toHaveTextContent(
      /\d+\s*%/,
    );
    expect(screen.queryByTestId("data-quality-score")).toBeNull();
  });
});
