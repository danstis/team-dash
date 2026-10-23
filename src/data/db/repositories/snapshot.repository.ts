/**
 * T052 — `SnapshotRepository` (US2, BSOD-306).
 *
 * The storage primitive for the DERIVED daily snapshot cache
 * (FR-026a / FR-026b / FR-027 / FR-068, data-model.md → Snapshot).
 *
 * What this module owns
 * ----------------------
 * 1. **The read path** — `getSnapshot(workspaceGid, date)` returns the
 *    cached row for one local calendar day, or `null` when that day was
 *    never recorded. The snapshot cache is a *cache*: the task rows in
 *    the local cache remain the source of truth (FR-026a), so a missing
 *    day is reported as a missing day, never as a fabricated row.
 *
 * 2. **The write path** — `backfillSnapshots(workspaceGid, dates, compute)`
 *    derives one snapshot row per local calendar day and stores it. The
 *    `snapshots` table is keyed by `[workspaceGid+localCalendarDate]`
 *    (schema.ts), so writing a day that already exists REPLACES that
 *    day's row — the FR-026a "a second successful refresh on the same
 *    calendar day MUST replace that day's cached snapshot rather than
 *    creating an additional one" invariant is a property of the key, not
 *    of a delete-then-insert dance. The rows are written in ONE Dexie
 *    transaction so a half-computed backfill never lands.
 *
 * 3. **The day key** — `localCalendarDateOf(instant)` names a local
 *    calendar day in the `YYYY-MM-DD` form the table is keyed by. The
 *    browser's local timezone is the default reporting basis (FR-029), and
 *    FR-030 applies the same basis to the snapshot-day boundary. The
 *    domain layer exposes the equivalent helper for the UI and metric
 *    layers (`src/domain/datetime` → `toIsoDate(date, "local")`); this
 *    module keeps its own copy because the storage layer must not import
 *    from `src/domain/**` (the boundary the sibling repositories
 *    document).
 *
 * Who may call this module
 * -------------------------
 * `RefreshStagingRepository.commit()` — and nothing else
 * (contracts/storage-repository.md: "Only ever called from
 * `RefreshStagingRepository.commit(); never called directly by UI code, so
 * a snapshot can never exist without a corresponding successful
 * RefreshSession (FR-068)"). The commit path is the only path that may
 * write the cache at all, so a failed, cancelled, or partial refresh can
 * never produce, replace, or backfill a snapshot: it never reaches
 * `commit()`.
 *
 * The `compute` callback
 * ----------------------
 * `backfillSnapshots` takes the computation as a callback so the storage
 * primitive stays a storage primitive: the FIGURES that go into a snapshot
 * row are derived by the metric layer
 * (`calculateBacklogDirection` — wired in by T085), not re-implemented
 * here. This row (T052) ships the primitive and the commit() coupling;
 * T085 replaces the computation with the metric's single path. Until then
 * the refresh pipeline records the day's figures itself and stages them,
 * and `commit()` hands them to this module.
 *
 * Boundary
 * --------
 * This module lives under `src/data/db/repositories/` (peer to
 * `cache.repository.ts`, `credential.repository.ts`, and
 * `refresh-staging.repository.ts`) and imports only from `src/data/db/
 * schema.ts` plus Dexie itself. It does not import from `src/app/**`,
 * `src/features/**`, `src/domain/**`, or `src/shared/**`.
 */
import Dexie, { type Transaction } from "dexie";

import { db } from "../schema";
import type { Snapshot } from "../schema";

/**
 * A local calendar day in the `YYYY-MM-DD` form the `snapshots` table is
 * keyed by (data-model.md → Snapshot → `localCalendarDate`). The schema
 * types the column as a plain `string`; this alias names the shape at
 * the repository boundary so a caller cannot pass an arbitrary string
 * without it being obvious in the signature.
 */
export type LocalCalendarDate = string;

/**
 * The `SnapshotRepository` surface — the contract declared in
 * `specs/001-asana-team-dashboard/contracts/storage-repository.md`:
 *
 * ```
 * interface SnapshotRepository {
 *   getSnapshot(workspaceGid: string, date: ISODate): Promise<Snapshot | null>;
 *   backfillSnapshots(workspaceGid: string, dates: ISODate[], compute: (date: ISODate) => Snapshot): Promise<void>;
 *   // Only ever called from RefreshStagingRepository.commit(); never called
 *   // directly by UI code, so a snapshot can never exist without a
 *   // corresponding successful RefreshSession (FR-068).
 * }
 * ```
 */
export interface SnapshotRepository {
  /**
   * The cached snapshot for one local calendar day, or `null` when that
   * day was never recorded for the workspace. A `null` is the honest
   * answer for an unrecorded day — the snapshot layer is a derived cache
   * (FR-026a), so it never invents a row.
   */
  getSnapshot(
    workspaceGid: string,
    date: LocalCalendarDate,
  ): Promise<Snapshot | null>;

  /**
   * Derive and store one snapshot row per local calendar day.
   *
   * `compute` is the sole computation path for a day's figures: it is
   * called once per date and returns the row to store. The row MUST be
   * keyed by the requested `(workspaceGid, date)` pair — a row keyed by
   * another day or another workspace is a programming error and is
   * rejected rather than silently written under the wrong key (Principle
   * V, data integrity).
   *
   * A date that already has a row is REPLACED, not duplicated (FR-026a).
   * The whole batch is written in one Dexie transaction, so a failure
   * part-way through leaves the previously stored days untouched.
   */
  backfillSnapshots(
    workspaceGid: string,
    dates: readonly LocalCalendarDate[],
    compute: (date: LocalCalendarDate) => Snapshot | Promise<Snapshot>,
  ): Promise<void>;
}

/**
 * The local calendar day an instant falls on, in the `YYYY-MM-DD` form
 * the `snapshots` table is keyed by.
 *
 * The local calendar accessors (`getFullYear` / `getMonth` / `getDate`)
 * resolve the day in the browser's own timezone, which is the default
 * reporting basis (FR-029) and the basis FR-030 applies to the
 * snapshot-day boundary. The month and day are zero-padded so the result
 * sorts lexicographically in the same order as it sorts chronologically.
 */
export function localCalendarDateOf(instant: Date): LocalCalendarDate {
  const year = String(instant.getFullYear());
  const month = String(instant.getMonth() + 1).padStart(2, "0");
  const day = String(instant.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Whether the caller is already inside a Dexie transaction.
 *
 * `Dexie.currentTransaction` returns the ambient transaction when the
 * call runs inside one and `null` outside it. Dexie types the getter as a
 * non-nullable `Transaction`, so the cast restores the honest type — the
 * runtime getter really does return `null` outside a transaction.
 */
function isInsideTransaction(): boolean {
  const ambient = (Dexie as { currentTransaction: Transaction | null })
    .currentTransaction;
  return ambient !== null && ambient !== undefined;
}

/**
 * Reject a computed row that is not keyed by the day it was computed for.
 *
 * The snapshot table's primary key is `[workspaceGid+localCalendarDate]`;
 * a row whose key disagrees with the requested `(workspaceGid, date)`
 * would be stored under a different day than the caller asked for, which
 * is precisely the corruption FR-026a and FR-027 forbid. Throwing here
 * rolls the surrounding transaction back rather than letting a
 * mis-keyed row reach the cache.
 */
function assertRowMatchesRequest(
  workspaceGid: string,
  date: LocalCalendarDate,
  row: Snapshot,
): void {
  if (row.workspaceGid !== workspaceGid) {
    throw new TypeError(
      `snapshotRepository.backfillSnapshots: the snapshot computed for "${date}" belongs to workspace "${row.workspaceGid}", expected "${workspaceGid}"`,
    );
  }
  if (row.localCalendarDate !== date) {
    throw new TypeError(
      `snapshotRepository.backfillSnapshots: the snapshot computed for "${date}" is keyed by "${row.localCalendarDate}"`,
    );
  }
}

/**
 * Build a `SnapshotRepository` bound to the shared Dexie database.
 *
 * Exported as a factory (like `createCacheRepository`) so a test can
 * construct the surface without monkey-patching the shared singleton.
 */
export function createSnapshotRepository(): SnapshotRepository {
  return {
    async getSnapshot(
      workspaceGid: string,
      date: LocalCalendarDate,
    ): Promise<Snapshot | null> {
      const row = await db.snapshots.get([workspaceGid, date]);
      return row ?? null;
    },

    async backfillSnapshots(
      workspaceGid: string,
      dates: readonly LocalCalendarDate[],
      compute: (date: LocalCalendarDate) => Snapshot | Promise<Snapshot>,
    ): Promise<void> {
      // A repeated date is one row, not two: deduping here keeps the
      // "one snapshot per local calendar day" invariant true even if a
      // caller passes the same day twice.
      const uniqueDates = Array.from(new Set(dates));
      if (uniqueDates.length === 0) {
        return;
      }

      const rows: Snapshot[] = [];
      for (const date of uniqueDates) {
        const row = await compute(date);
        assertRowMatchesRequest(workspaceGid, date, row);
        rows.push(row);
      }

      const write = async (): Promise<void> => {
        // `bulkPut` REPLACES a row whose `[workspaceGid+localCalendarDate]`
        // primary key already exists — the FR-026a same-day replacement
        // is a property of the key, so a second successful refresh of the
        // same local day overwrites that day's row instead of appending
        // a second one.
        await db.snapshots.bulkPut(rows);
      };

      if (isInsideTransaction()) {
        // Called from `RefreshStagingRepository.commit()`: the caller
        // already opened the transaction that covers the whole refresh,
        // so these writes JOIN it (and roll back with it) instead of
        // opening a second transaction of their own — the commit stays
        // the single atomic transaction the FR-022 / FR-068 contract
        // requires.
        await write();
        return;
      }

      await db.transaction("rw", db.snapshots, write);
    },
  };
}

/**
 * The repository singleton. The module exports both the interface and
 * the implementation so a test can construct a fake `SnapshotRepository`
 * without monkey-patching the global instance.
 */
export const snapshotRepository: SnapshotRepository =
  createSnapshotRepository();
