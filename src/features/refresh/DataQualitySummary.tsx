/**
 * BSOD-311 (T064) — `DataQualitySummary`, the FR-084 refresh-outcome
 * data-completeness summary (US2).
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
 * surface makes countable — a missing or malformed Priority is FLAGGED
 * rather than silently treated as an absent value, and a missing or
 * malformed value is never converted into a favourable state (e.g. a
 * missing due date is never read as "on time"). The summary is where
 * those flags become a number the user can read, so the metric panels
 * below it can be judged with the data-quality context Principle VII
 * requires ("material data-quality gaps wherever they affect
 * interpretation").
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
 * So this surface consumes `DataQualityFlag[]` — the findings of the
 * scan that runs over the most recent refresh — and renders the
 * COUNTS (plus the drill-down set behind each count).
 *
 * What this module owns
 * ---------------------
 * - `<DataQualitySummary />` — the FR-084 panel: the total number of
 *   data-completeness findings the most recent refresh surfaced, and
 *   one row per finding kind with the number of affected tasks.
 * - The drill-down HAND-OFF. Each row hands the whole
 *   `DataQualityFlag` back to the caller when the user activates it,
 *   so the caller can list the affected tasks (`taskGids`). This
 *   surface does not render the task list itself — that is the
 *   drill-down the task-detail surface owns (US3).
 *
 * What this module deliberately does NOT own
 * ------------------------------------------
 * - The scan that produces the flags. The findings originate from the
 *   refresh's validation pass: the Asana client reports a
 *   `validation_error` outcome carrying the structured `ZodIssue[]`
 *   (`src/data/asana/types.ts`), and the scan that attributes those
 *   issues to a task gid and a `DataQualityFlagKind` produces the
 *   `DataQualityFlag[]` this surface renders. That scan is T112
 *   (`calculateDataQuality`, US10); this row ships the surface the
 *   scan feeds.
 * - The per-metric data-quality panel (T113 / BSOD-344, FR-079) —
 *   the METRIC view of the same scan. This surface is the
 *   post-refresh summary the user reads next to the refresh outcome.
 * - The refresh outcome itself (`OutcomeBanner` in
 *   `RefreshControls.tsx`) and the cached-vs-fresh label
 *   (`FreshnessBanner`). This surface is a sibling of both: it says
 *   how much to trust the data, not whether it is fresh.
 *
 * Caller contract
 * ---------------
 * The `flags` prop MUST be the findings of the MOST RECENT refresh.
 * An empty array therefore means "the most recent refresh's scan ran
 * and found nothing" — the surface says exactly that, and never claims
 * the data is complete in every respect. A caller that has not
 * refreshed yet MUST NOT mount this surface with an empty array; it
 * has no "most recent refresh" to summarise, and the first-run
 * surface (`EmptyDashboard`) is the honest one for that state.
 *
 * Determinism
 * -----------
 * The surface is fully synchronous on first paint: no async init, no
 * IndexedDB read, no network. Everything it renders is derived from
 * its props, so the integration test can assert the whole contract
 * without a live workspace (Principle III, NFR-005).
 *
 * Honesty
 * -------
 * The surface discloses counts and the tasks behind them — never a
 * composite score. The constitution forbids "hidden or unexplained
 * composite performance scores", and FR-084 asks for a summary the
 * user can reason about, not a grade.
 *
 * Accessibility
 * -------------
 * The surface is a polite status region (`role="status"`,
 * `aria-live="polite"`): a data-completeness summary is
 * informational, not a failure, so it must not be announced as an
 * alert. The heading is an `<h2>` because the surface renders INSIDE
 * the dashboard, whose own `<h1>` ("Team Dash") owns the top level —
 * an `<h1>` here would produce two top-level headings in one document
 * (WCAG 1.3.1). Each row is a real `<button>` with a visible text
 * label when a drill-down is wired, so the drill-down is reachable by
 * keyboard and announced by its accessible name ("Missing Priority: 2
 * tasks").
 *
 * URL / log / value safety (FR-008)
 * ---------------------------------
 * The component renders no credential, no workspace name, and no
 * cached record; it has no access to any of them. It surfaces only
 * the counts and the opaque task gids the caller passes in, so a
 * caller cannot leak a token through this surface.
 *
 * Boundary
 * --------
 * `src/features/refresh/**` is the plan-documented home for the
 * refresh-flow React UI. This module imports React and the domain's
 * `DataQualityFlag` TYPE only — no `src/data/**` import, no Dexie
 * read, no Asana call, and no runtime dependency on the domain layer.
 * The flag `kind` union is imported rather than re-declared locally
 * so the label map below cannot drift from the domain's enumeration:
 * adding a kind to `src/domain/types.ts` fails this module's
 * compilation until the new kind is labelled here.
 */
import type { ReactElement } from "react";

import type { DataQualityFlag } from "../../domain/types";

/* -------------------------------------------------------------------------- */
/* Props                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The props `<DataQualitySummary />` consumes. Every field is
 * `readonly` and consumed via `Readonly<Props>` per the SonarCloud
 * `typescript:S6759` project-wide convention.
 */
export interface DataQualitySummaryProps {
  /**
   * The data-completeness findings of the most recent refresh — one
   * entry per finding kind, carrying the number of affected tasks and
   * the opaque task gids behind that number.
   *
   * The findings come from the refresh's validation pass: the Asana
   * client reports a `validation_error` outcome carrying the
   * structured `ZodIssue[]`, and the scan attributes those issues to
   * a kind and a task gid. An empty array means the scan ran and
   * found nothing — see the caller contract in the module header.
   */
  readonly flags: readonly DataQualityFlag[];
  /**
   * The drill-down action. When supplied, each row is a button that
   * hands the whole `DataQualityFlag` back to the caller so the
   * affected tasks (`taskGids`) can be listed. When omitted, the rows
   * are static text and the surface renders the counts only.
   */
  readonly onSelectFlag?: (flag: DataQualityFlag) => void;
}

/* -------------------------------------------------------------------------- */
/* Labels                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The human label for each finding kind. The map is keyed by the
 * domain's `DataQualityFlag["kind"]` union, so a kind added to
 * `src/domain/types.ts` breaks this module's compilation until it is
 * labelled here — the label map cannot silently fall through.
 *
 * "Priority" is capitalised because it is the name of the Asana
 * custom field; the rest of the copy is Australian English
 * (Constitution §"Documentation").
 */
const FLAG_LABELS: Readonly<Record<DataQualityFlag["kind"], string>> = {
  missing_assignee: "Missing assignee",
  missing_estimate: "Missing estimate",
  missing_priority: "Missing Priority",
  malformed_priority: "Malformed Priority",
  missing_due_date: "Missing due date",
  missing_actual_time: "Missing actual time",
};

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The FR-084 data-completeness summary for the most recent refresh.
 *
 * The surface renders the total number of findings plus one row per
 * finding kind with the number of affected tasks. A finding with a
 * zero count is not rendered — there is nothing to disclose about it,
 * and a "0 tasks" row would read as noise.
 */
export function DataQualitySummary({
  flags,
  onSelectFlag,
}: Readonly<DataQualitySummaryProps>): ReactElement {
  const visibleFlags = flags.filter((flag) => flag.count > 0);
  const totalIssueCount = visibleFlags.reduce(
    (total, flag) => total + flag.count,
    0,
  );

  const summaryText =
    totalIssueCount === 0
      ? "No data-completeness issues were found in the most recent refresh."
      : `${totalIssueCount} data-completeness ${
          totalIssueCount === 1 ? "issue was" : "issues were"
        } found in the most recent refresh. Metrics that depend on the affected fields may be incomplete.`;

  return (
    <section
      className="td-data-quality-summary"
      data-testid="data-quality-summary"
      data-issue-total={totalIssueCount}
      data-flag-count={visibleFlags.length}
      role="status"
      aria-live="polite"
      aria-label="Data quality summary"
    >
      <h2>Data quality summary</h2>
      <p data-testid="data-quality-summary-total">{summaryText}</p>
      {visibleFlags.length > 0 ? (
        <ul data-testid="data-quality-flag-list">
          {visibleFlags.map((flag) => (
            <li
              key={flag.kind}
              data-testid="data-quality-flag"
              data-flag-kind={flag.kind}
              data-flag-count={flag.count}
              data-drilldown-count={flag.taskGids.length}
            >
              {onSelectFlag === undefined ? (
                <span data-testid="data-quality-flag-label">
                  {FLAG_LABELS[flag.kind]}: {flag.count}{" "}
                  {flag.count === 1 ? "task" : "tasks"}
                </span>
              ) : (
                <button
                  type="button"
                  className="td-data-quality-summary-flag-button"
                  data-testid="data-quality-flag-button"
                  onClick={() => {
                    onSelectFlag(flag);
                  }}
                >
                  {FLAG_LABELS[flag.kind]}: {flag.count}{" "}
                  {flag.count === 1 ? "task" : "tasks"}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
