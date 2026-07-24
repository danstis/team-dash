/**
 * T031 — `WorkspaceProvider`, the top-level shell context for the
 * currently selected Asana workspace.
 *
 * The credentials context answers "is there a usable token right now?"
 * The workspace context answers the matching question for the
 * selection: "which Asana workspace is the user reporting against, and
 * what `ViewState` does that imply for the rest of the app?"
 *
 * ## Why a context, not a hook
 *
 * The route guard T046 needs to compose the two providers' states
 * into a single route-level decision. A hook would tie that decision
 * to whichever feature first calls it; a context lets the router
 * mount above the feature boundary and ask
 * `useWorkspace().state` from inside its guard component.
 *
 * ## What "selected workspace" means here
 *
 * The Dexie schema (T021) keys the `workspaces` store by `gid`, so
 * the act of "selecting" a workspace is a Dexie upsert with
 * `selectedAt` populated. The provider reads the row whose
 * `selectedAt` is most recent (the current convention: only one
 * row exists at a time, but a future multi-workspace history view
 * could leverage the same shape without a schema change).
 *
 * ## What we deliberately do not own
 *
 * - The Asana "list accessible workspaces" call is owned by T039
 *   (`listWorkspaces` in `src/data/asana/client.ts`) and T043
 *   (`WorkspaceSelector` in `src/features/credentials/`). This
 *   provider only manages the *local selection*.
 *
 * ## Boundary
 *
 * This module lives under `src/app/**`. It imports from `src/data/**`
 * (the Dexie schema) and from `src/domain/**` only for type imports
 * (`ViewState`, `ISODateTime`). It does not import from
 * `src/features/**` — the shell mounts features, not the other way
 * around.
 *
 * The `eslint-plugin-boundaries` configuration in `eslint.config.js`
 * currently constrains `src/domain/**` only (Constitution Principle
 * VI's lint-enforced half of the boundary); the "no feature import
 * from app" rule is enforced by architectural convention and code
 * review, not by lint. A future contributor may choose to tighten
 * the rule by adding a `boundaries/dependencies` policy on
 * `src/app/**` so this convention becomes lint-enforced too.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { db } from "../data/db/schema";
import type { ViewState, ISODateTime } from "../domain/types";

/**
 * The local representation of a workspace row. Mirrors the Dexie
 * `Workspace` interface from `src/data/db/schema.ts` (T021 /
 * data-model.md) — kept as a local type alias so this module has no
 * compile-time dependency on the Dexie row shape beyond the fields it
 * actually surfaces.
 */
export interface SelectedWorkspace {
  gid: string;
  name: string;
  selectedAt: ISODateTime;
}

export interface WorkspaceContextValue {
  /**
   * The current `ViewState`. `'loading'` on the first synchronous
   * render; resolves to `'first_run'` (no selection) or `'ready'`
   * (a selection is loaded from IndexedDB) on the next render.
   */
  state: ViewState;
  /** The currently selected workspace, or `null` when none is selected. */
  workspace: SelectedWorkspace | null;
  /** Persist a selection to IndexedDB; resolves the state to `'ready'`. */
  selectWorkspace: (workspace: SelectedWorkspace) => Promise<void>;
  /** Clear any persisted selection; resolves the state to `'first_run'`. */
  clearSelection: () => Promise<void>;
}

const WORKSPACE_CONTEXT_DEFAULT: WorkspaceContextValue = {
  state: "loading",
  workspace: null,
  selectWorkspace: async () => {
    throw new Error(
      "WorkspaceProvider.selectWorkspace called outside a provider",
    );
  },
  clearSelection: async () => {
    throw new Error(
      "WorkspaceProvider.clearSelection called outside a provider",
    );
  },
};

const WorkspaceContext = createContext<WorkspaceContextValue>(
  WORKSPACE_CONTEXT_DEFAULT,
);

WorkspaceContext.displayName = "WorkspaceContext";

/**
 * Read the current workspace selection. Throws if called outside the
 * provider so a feature component that forgets to wrap with
 * `<WorkspaceProvider>` fails fast at the call site rather than
 * silently rendering with the default `'loading'` state.
 */
export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (value === WORKSPACE_CONTEXT_DEFAULT) {
    throw new Error("useWorkspace must be called inside <WorkspaceProvider>");
  }
  return value;
}

export interface WorkspaceProviderProps {
  children: ReactNode;
}

/**
 * Mount the workspace context. Renders its children on the first
 * synchronous render with `state = 'loading'`; runs the IndexedDB
 * read on `useEffect`; resolves to `'first_run'` or `'ready'` on the
 * next render.
 */
export function WorkspaceProvider({
  children,
}: WorkspaceProviderProps): ReactNode {
  const [state, setState] = useState<ViewState>("loading");
  const [workspace, setWorkspace] = useState<SelectedWorkspace | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      // The schema (T021) does not enforce a single workspace row; it
      // is the caller's responsibility to keep the store consistent.
      // The shell convention is "one selection at a time", so we read
      // all rows and pick the most-recently-selected. Sorting in
      // JavaScript (rather than indexing `selectedAt`) keeps the
      // schema minimal — there is no query-load-driven reason to index
      // a field whose cardinality is at most a handful of rows.
      const all = await db.workspaces.toArray();
      if (cancelled) {
        return;
      }
      if (all.length === 0) {
        setState("first_run");
        return;
      }
      const mostRecent = all.reduce((acc, row) =>
        acc.selectedAt > row.selectedAt ? acc : row,
      );
      // `selectedAt` is a branded `ISODateTime` at the type level but
      // arrives from Dexie as a plain `string` (Dexie does not preserve
      // branded primitives across the IndexedDB round-trip). The cast
      // is safe: the row was written as an ISO-8601 string in
      // `selectWorkspace` below, so the value satisfies the brand
      // shape at runtime. A future migration to typed Dexie columns
      // can drop the cast.
      setWorkspace({
        gid: mostRecent.gid,
        name: mostRecent.name,
        selectedAt: mostRecent.selectedAt as ISODateTime,
      });
      setState("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectWorkspace = useCallback(
    async (next: SelectedWorkspace): Promise<void> => {
      // Dexie's `workspaces` table stores `selectedAt` as a plain
      // string; the `ISODateTime` brand exists only at the
      // presentation/contract layer (T031's `SelectedWorkspace` shape).
      // The string pass-through is structurally equivalent.
      await db.workspaces.put({
        gid: next.gid,
        name: next.name,
        selectedAt: next.selectedAt as string,
      });
      setWorkspace(next);
      setState("ready");
    },
    [],
  );

  const clearSelection = useCallback(async (): Promise<void> => {
    // Clear every workspace row, not just the selected one, so a
    // future multi-workspace history (out of scope for T031, but
    // already representable in the schema) does not leave a stale
    // selection visible after a "switch workspace" flow.
    await db.workspaces.clear();
    setWorkspace(null);
    setState("first_run");
  }, []);

  const value = useMemo<WorkspaceContextValue>(
    () => ({ state, workspace, selectWorkspace, clearSelection }),
    [state, workspace, selectWorkspace, clearSelection],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}
