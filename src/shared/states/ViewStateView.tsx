/**
 * T032 — `<ViewStateView>` dispatcher.
 *
 * Switches on a `ViewState` literal and renders the matching shared
 * primitive (`src/shared/states/*`). For the `'ready'` state it
 * renders the supplied `children` slot instead of a placeholder — a
 * feature's actual UI is the "ready" surface, so wrapping it in a
 * no-op primitive would just add an extra DOM node.
 *
 * Why a dispatcher (rather than every consumer importing the matching
 * primitive directly):
 *
 * - Single point where the `ViewState` literal union is checked
 *   exhaustively (a TypeScript `assertNever` branch forces a compile
 *   error if a new `ViewState` literal is added without a matching
 *   primitive). A feature component that wants to render "whatever the
 *   current state is" calls `<ViewStateView state={...} />` rather
 *   than building the same switch by hand.
 *
 * - Single point where the `data-view-state` hook is applied to the
 *   root element. Feature tests query `data-view-state` to assert the
 *   active state, regardless of which primitive is currently rendered.
 *
 * - Single point where the `'ready'` slot is unpacked — the feature's
 *   own UI stays inside its own `<main>` / chrome, and the dispatcher
 *   does not insert an extra wrapping element when there's nothing to
 *   disclose.
 */
import { type ReactElement, type ReactNode } from "react";

import type { ViewState } from "../../domain/types";

import { CachedStaleState } from "./CachedStaleState";
import { EmptyState } from "./EmptyState";
import { FirstRunState } from "./FirstRunState";
import { InsufficientPermissionState } from "./InsufficientPermissionState";
import { InvalidTokenState } from "./InvalidTokenState";
import { LoadingState } from "./LoadingState";
import { NoResultsState } from "./NoResultsState";
import { OfflineState } from "./OfflineState";
import { PartialDataState } from "./PartialDataState";
import { RateLimitedState } from "./RateLimitedState";

export interface ViewStateViewProps {
  /** The current `ViewState` literal. */
  state: ViewState;
  /**
   * The 'ready' slot. Rendered verbatim for `state === 'ready'`;
   * ignored for every other state (the matching primitive supplies
   * the content).
   */
  children?: ReactNode;
  /**
   * Forwarded to the matching primitive's root element. Optional;
   * useful for styling the region from the feature's CSS layer.
   */
  className?: string;
  /** Forwarded for test queries. */
  "data-testid"?: string;
  /** Forwarded for accessibility labels. */
  "aria-label"?: string;
  /**
   * Optional context forwarded to specific primitives:
   *
   * - `lastRefreshedAt` — required by `'cached_stale'`
   * - `retryAfterMs` — optional on `'rate_limited'`
   * - `partial` — required by `'partial_data'` (`{ errorDetail,
   *   itemsRetrieved, totalExpected }`)
   */
  lastRefreshedAt?: string;
  retryAfterMs?: number;
  partial?: {
    errorDetail: string;
    itemsRetrieved: number;
    totalExpected: number;
  };
}

/**
 * TypeScript's "exhaustive switch" pattern — used in the `default`
 * branch so a future contributor who adds a new `ViewState` literal
 * gets a compile-time error pointing at the missing case here. The
 * function signature returns `never` so the switch is guaranteed to
 * cover every literal at the type level.
 */
function assertNever(value: never): never {
  throw new Error(
    `ViewStateView received an unknown ViewState literal: ${String(value)}`,
  );
}

/**
 * Dispatch to the matching shared primitive based on the supplied
 * `ViewState` literal.
 */
export function ViewStateView({
  state,
  children,
  className,
  "data-testid": dataTestId,
  "aria-label": ariaLabel,
  lastRefreshedAt,
  retryAfterMs,
  partial,
}: ViewStateViewProps): ReactElement {
  switch (state) {
    case "ready":
      return (
        <div
          className={className ?? "td-view-state-ready"}
          data-testid={dataTestId}
          data-view-state="ready"
          aria-label={ariaLabel}
        >
          {children}
        </div>
      );
    case "loading":
      return (
        <LoadingState
          className={className}
          data-testid={dataTestId}
          aria-label={ariaLabel}
        />
      );
    case "first_run":
      return (
        <FirstRunState
          className={className}
          data-testid={dataTestId}
          aria-label={ariaLabel}
        />
      );
    case "empty":
      return (
        <EmptyState
          className={className}
          data-testid={dataTestId}
          aria-label={ariaLabel}
        />
      );
    case "cached_stale":
      return (
        <CachedStaleState
          className={className}
          data-testid={dataTestId}
          aria-label={ariaLabel}
          lastRefreshedAt={lastRefreshedAt ?? "an unknown time"}
        />
      );
    case "offline":
      return (
        <OfflineState
          className={className}
          data-testid={dataTestId}
          aria-label={ariaLabel}
        />
      );
    case "invalid_token":
      return (
        <InvalidTokenState
          className={className}
          data-testid={dataTestId}
          aria-label={ariaLabel}
        />
      );
    case "insufficient_permission":
      return (
        <InsufficientPermissionState
          className={className}
          data-testid={dataTestId}
          aria-label={ariaLabel}
        />
      );
    case "rate_limited":
      return (
        <RateLimitedState
          className={className}
          data-testid={dataTestId}
          aria-label={ariaLabel}
          retryAfterMs={retryAfterMs}
        />
      );
    case "partial_data":
      return (
        <PartialDataState
          className={className}
          data-testid={dataTestId}
          aria-label={ariaLabel}
          errorDetail={partial?.errorDetail ?? "Unknown failure"}
          itemsRetrieved={partial?.itemsRetrieved ?? 0}
          totalExpected={partial?.totalExpected ?? 0}
        />
      );
    case "no_results":
      return (
        <NoResultsState
          className={className}
          data-testid={dataTestId}
          aria-label={ariaLabel}
        />
      );
    default:
      return assertNever(state);
  }
}
