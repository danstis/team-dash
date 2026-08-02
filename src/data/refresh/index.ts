/**
 * `src/data/refresh` — barrel export for the refresh-and-cache
 * pipeline (US2).
 *
 * This module is the single import surface the rest of the codebase
 * uses to reach the refresh orchestrator and the wire-to-cache
 * normalisers. A feature layer (e.g. `RefreshControls`) imports the
 * orchestrator via `@data/refresh`; a future feature-layer test that
 * needs to assert "the wire shape becomes the cache row shape"
 * imports the normalise helpers via the same barrel.
 *
 * Re-exports
 * ----------
 * - Orchestrator factory + types: `createRefreshOrchestrator`,
 *   `realAsanaClient`, `RefreshOrchestrator`, `RefreshOrchestratorDeps`,
 *   `AsanaClientSurface`, `RefreshOutcome`, `RefreshFailureReason`,
 *   `defaultNow`, `defaultMakeSessionId`.
 * - Normalise helpers (FR-014, FR-081, FR-082, FR-016): the per-
 *   resource normalisers (`normaliseProject`, `normaliseUser`,
 *   `normalisePortfolio`, `normaliseSection`, `normaliseWorkspace`),
 *   the custom-field extractors (`extractEstimatedMinutes`,
 *   `extractPriorityOptionId`), the task helpers (`normaliseTask`,
 *   `applySubtaskProjectInheritance`, `buildPriorityField`,
 *   `buildDependencyEdges`, `deriveAsanaTeams`), and the well-known
 *   custom-field-name constants (`PRIORITY_CUSTOM_FIELD_NAME`,
 *   `ESTIMATED_MINUTES_CUSTOM_FIELD_NAME`).
 * - Snapshot backfill (T02, FR-026a, D002): the
 *   `SnapshotRepository.backfillSnapshots` surface and singleton
 *   used by `refreshStagingRepository.commit()` to write the daily
 *   snapshot row inside the cache-flush transaction.
 *
 * Boundary
 * --------
 * `src/data/refresh/**` is the data-side refresh pipeline. The barrel
 * re-exports from this directory only; downstream importers MUST NOT
 * reach past the barrel into `./normalise` or `./refresh-orchestrator`
 * because future contributors adding cross-module constants (e.g. a
 * shared retry-policy table) will surface them through the barrel
 * first.
 */

export {
  applySubtaskProjectInheritance,
  buildDependencyEdges,
  buildPriorityField,
  deriveAsanaTeams,
  ESTIMATED_MINUTES_CUSTOM_FIELD_NAME,
  extractEstimatedMinutes,
  extractPriorityOptionId,
  normalisePortfolio,
  normaliseProject,
  normaliseSection,
  normaliseTask,
  normaliseUser,
  normaliseWorkspace,
  PRIORITY_CUSTOM_FIELD_NAME,
} from "./normalise";

export type { NormaliseTaskContext } from "./normalise";

export {
  createRefreshOrchestrator,
  defaultMakeSessionId,
  defaultNow,
  realAsanaClient,
} from "./refresh-orchestrator";

export type {
  AsanaClientSurface,
  RefreshFailureReason,
  RefreshOrchestrator,
  RefreshOrchestratorDeps,
  RefreshOutcome,
} from "./refresh-orchestrator";

export { snapshotRepository } from "./snapshot-repository";

export type { SnapshotRepository } from "./snapshot-repository";
