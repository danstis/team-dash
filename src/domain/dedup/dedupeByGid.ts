/**
 * `dedupeByGid` — the single FR-036 deduplication helper every metric
 * calculator in `src/domain/metrics/**` uses when forming a workspace or
 * multi-project aggregate.
 *
 * Background
 * ----------
 * FR-036 (`/specs/001-asana-team-dashboard/spec.md`) requires: "At any
 * grouping or total above a single project (combined-project views,
 * portfolios, teams, assignees, or workspace totals), the system MUST
 * count each task exactly once by its `gid`." The same rule applies per
 * FR-038 to counts, effort totals, time variance figures, overdue
 * counts/effort, completion counts/effort, and backlog trend figures, and
 * per FR-039/FR-040 to portfolio- and reporting-team-level totals.
 *
 * `contracts/metrics-engine.md` Shared Output Rule 1 makes the
 * implementation mandatory: "any total at or above single-project
 * grouping MUST deduplicate by `gid` using `domain/dedup`'s `dedupeByGid`
 * helper — never a hand-rolled `Set` per metric, so the dedup rule cannot
 * silently diverge between metrics." This module IS that helper.
 *
 * `gid` is an opaque string per FR-017 ("The system MUST treat Asana `gid`
 * values as opaque strings for identity, comparison, and storage, without
 * assuming a numeric size, UUID, or GUID format"). The dedup is therefore
 * a strict string equality on `gid` — no normalisation, trimming, case
 * folding, or numeric coercion ever occurs.
 *
 * Boundary
 * --------
 * This file lives in `src/domain/**`, so it MUST stay presentation-free,
 * browser-free, and network-free per Constitution Principle VI. The
 * `eslint-plugin-boundaries` rule in `eslint.config.js` enforces that
 * constraint; this file deliberately imports nothing beyond its own
 * helpers.
 *
 * Performance
 * -----------
 * Implemented as a single-pass `O(n)` scan with an early-exit on
 * duplicate detection so a 25,000-task metric scan stays within the
 * SC-003 "filter/group/re-render updates within 1s" budget (the rest of
 * that budget is consumed by the metric calculator's own aggregation;
 * dedup itself is `O(n)` with `O(n)` auxiliary space in the worst case).
 */

interface HasGid {
  readonly gid: string;
}

/**
 * Returns a new array containing the first occurrence of each `gid` in
 * `items`, in original input order. Duplicates (rows sharing a `gid`) are
 * dropped — the surviving row carries the FIRST occurrence's payload so a
 * deterministic re-aggregation from `items` reproduces the displayed
 * figure (drill-down parity, contracts/metrics-engine.md Output Rule 5).
 *
 * The input array is not mutated; the returned array is a fresh
 * allocation so callers can safely pass it into downstream reducers
 * without aliasing concerns.
 *
 * Generic over `T extends { readonly gid: string }` so a feature module
 * can pass either the full `Task` shape (data-model.md) or a narrower
 * per-metric projection; either way, every non-`gid` field on the first
 * occurrence is preserved verbatim.
 *
 * @example
 *   dedupeByGid([
 *     { gid: "1", name: "A" },
 *     { gid: "2", name: "B" },
 *     { gid: "1", name: "A (dup)" },
 *   ]);
 *   // => [{ gid: "1", name: "A" }, { gid: "2", name: "B" }]
 */
export function dedupeByGid<T extends HasGid>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    if (seen.has(item.gid)) {
      continue;
    }
    seen.add(item.gid);
    result.push(item);
  }

  return result;
}
