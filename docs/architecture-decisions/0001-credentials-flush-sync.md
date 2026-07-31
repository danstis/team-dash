# ADR 0001 — Synchronous commit for credential + workspace state transitions (`flushSync`)

| Status   | Decided                                                                                      |
| -------- | -------------------------------------------------------------------------------------------- |
| Deciders | Spec Kit Implementer (Dan / Squad Coordinator informed)                                      |
| Date     | 2026-07-31                                                                                   |
| Scope    | `src/app/credentials-context.tsx`, `src/app/workspace-context.tsx`, `tests/integration/**`   |
| Drivers  | BSOD-296 (child of BSOD-295); PR #106 (`fix/BSOD-295-wire-integration-ci`) at head `24e8eaf` |

## Context and problem statement

The BSOD-295 integration-test gate (`tests/integration/**` invoked from the new `.github/workflows/ci.yml` `test-integration` job) is a **required** check — Dan's bar is "must pass on this PR before merge". On head `0f7f6cd` the gate failed at CI run 30618147621 with:

```
AssertionError: expected null to be 'session'
 ❯ tests/integration/credentials/first-run.test.tsx:277
```

PR Review Sentinel reproduced locally: full integration suite 5× → 2× fail on the same assertion; single-file 5× → 0× fail. Sentinel also confirmed the failure is **pre-existing on `origin/main`** (1/6 runs on the pre-BSOD-295 commit) and is unrelated to the new route-guard diff — the failing assertion does not render `RouteGuard`.

The same root cause later surfaced in two more places under `--sequence.shuffle`:

- `first-run.test.tsx:474` — `expected null to deeply equal { Object (gid, name, …) }` (the workspace-side remount variant).
- `first-run.test.tsx:471` — `expected 'loading' to be 'first_run'` (the credentials mount-effect variant).

All three failures share the same underlying mechanism: a race between React's commit + descendants' `useEffect` and the test's `waitFor` observer on the post-commit DOM.

## Decision drivers

- **Constitution Principle III** ("A change MUST NOT merge while a required quality gate is failing. Flaky tests MUST be fixed or explicitly quarantined with a tracked remediation; they MUST NOT be casually retried until green.") — a flaky integration gate does not satisfy the merge bar; the flake is the bug.
- **Constitution Principle VI** ("Readable, conventional code MUST be preferred over cleverness") — `flushSync` is a documented React 18 escape hatch, not a clever workaround.
- **FR-005a** ("MUST immediately delete the previous encrypted token record and its associated non-extractable key from IndexedDB before or as part of the same operation that establishes the new state") — synchronous commit must happen **after** the delete, never before, so the persisted-state invariant is upheld.
- **FR-002a** ("MUST decrypt it automatically on launch without requiring a separate unlock step") — credentials provider's mount effect must surface its post-decrypt state synchronously enough that descendants (the route guard, the test probe) see the settled state on the same React tick.

## Considered options

### Option A — `flushSync` (chosen)

Wrap the batched `setMode` / `setMaskedIdentifier` / `setState` calls in `setSessionToken`, `setPersistentToken`, `clearToSessionOnly`, `clearAll`, `selectWorkspace`, `clearSelection`, and the credentials mount effect in `flushSync(() => { ... })`. The mount effect awaits the IndexedDB / decrypt side, then `flushSync`s the resulting state transition so descendants' effects fire in the same React tick that resolves the action promise.

Pros:

- Surgical: only the seven state-transition sites change; every consumer and test stays untouched.
- Aligns with the FR-005a invariant (delete-then-setState order preserved).
- Aligns with the FR-002a invariant (decrypt runs to completion before the post-decrypt state is committed).
- React 18 canonical escape hatch — documented, no version-specific surprise.

Cons:

- `flushSync` is generally discouraged for performance reasons; for user-initiated credential lifecycle actions (rare, sub-second, user-attended) the cost is negligible. The single test that touched this path (the US1 integration suite) was the surface we needed to protect, and the production route guard observes the same synchronous commit and renders `<FirstRunState />` / `<LoadingState />` / the placeholder accordingly.

### Option B — `useLayoutEffect` in the test probe (rejected)

`FirstRunGateProbe`'s `useEffect(() => { handlesRef.current = { credentials, workspace }; })` would become `useLayoutEffect`. Layout effects fire synchronously after DOM commit and before paint, eliminating the race window.

Pros: minimal change to one test-only file.

Cons:

- Test-infrastructure fix for a production-state-transition race. The race is real for any consumer that subscribes to provider state via `useEffect` — the route guard is the production consumer and would exhibit the same flicker. Fixing it only in the test would leave the route guard's surface vulnerable to a future regression.
- Sentinel's reproduction was specifically tagged "the race lives in `setSessionToken` / `setPersistentToken` / `clearToSessionOnly` effect ordering, not in `route-guard.tsx`". The provider-side fix matches that guidance.

### Option C — Restructure `waitFor` to poll the ref (rejected)

Change `tests/integration/credentials/first-run.test.tsx` to read `handlesRef` via `waitFor` instead of asserting synchronously after a DOM `waitFor`.

Pros: no production-code change.

Cons: addresses the symptom (the test's specific race), not the cause (the provider's async state transition). A future contributor who adds a new consumer that reads provider state via `useEffect` would reproduce the same bug outside the test harness. The constitution's Principle III mandates fixing the flake, not papering over it.

### Option D — Remove `await credentialRepository.*` and resolve synchronously (rejected)

Move the Dexie write / read / decrypt OUT of the async path so the entire state transition runs synchronously.

Pros: no `flushSync` needed.

Cons: violates FR-005a (delete must precede the new state) and FR-002a (the provider must await decrypt before surfacing `'ready'`). The async boundary is load-bearing, not incidental.

## Decision

**Chosen: Option A (`flushSync`).**

The fix lives in:

- `src/app/credentials-context.tsx` — `setSessionToken`, `setPersistentToken`, `clearToSessionOnly`, `clearAll`, and the credentials mount effect.
- `src/app/workspace-context.tsx` — `selectWorkspace`, `clearSelection`, and the workspace mount effect.

Every site keeps the original `await repositoryAction()` / `await credentialRepository.getCurrent()` before the state-transition block; only the state-transition block (the three `setState` calls and the related ref / masked-identifier updates) is wrapped in `flushSync(() => { ... })`. The `await` is the load-bearing FR-005a / FR-002a boundary; `flushSync` only commits the post-await state synchronously.

## Reproduction (before the fix)

- Sentinel reproduction, PR #106 review thread: full integration suite 5× → 2× fail at `first-run.test.tsx:277` (assertion `expected null to be 'session'`).
- My reproduction: full integration suite with `--sequence.shuffle --sequence.concurrent=false` → 4/15 fail across three assertion lines:
  - `:277` — `expected null to be 'session'` (the `setSessionToken` ordering race).
  - `:474` — `expected null to deeply equal { gid, name, … }` (the remount-after-`selectWorkspace` race).
  - `:471` — `expected 'loading' to be 'first_run'` (the credentials mount-effect race).
- CI run 30618147621: `Integration tests fail` on head `0f7f6cd`.

## Verification (after the fix)

On head `24e8eaf`:

- 20 runs default Vitest ordering → 0 failures.
- 20 runs `--sequence.shuffle` → 0 failures.
- 15 runs `--sequence.shuffle --sequence.concurrent=false` → 0 failures.
- Sentinel post-fix reproduction: 14/14 (8 default + 6 `--sequence.shuffle --sequence.concurrent=false`).
- Live CI on `24e8eaf` (run 30620652080): all 14 checks pass (`Integration tests pass`, downstream chain runs and passes).

## Root cause (canonical reproduction trace)

Three ingredients converge:

1. **`FirstRunGateProbe` in `tests/integration/credentials/first-run.test.tsx` (and any other consumer that subscribes via `useEffect`)** — publishes `handlesRef.current = { credentials, workspace }` from a `useEffect(() => { ... })` with no dependency array. The effect fires after every render.
2. **The test pattern** — `await handlesRef.current?.credentials?.setSessionToken(token, masked); await waitFor(() => expect(stateText).toBe('ready')); expect(handlesRef.current?.credentials?.mode).toBe('session')`. The `waitFor` resolves on the updated DOM (a `MutationObserver` callback fires after paint); the `expect` reads the ref synchronously after that.
3. **React 18's default commit + effect scheduling** — `setState` calls inside an async function (after `await`) are batched into a single re-render. The render commits, the DOM updates, the browser paints, then the descendants' `useEffect` fires asynchronously. Between the DOM update and the effect firing, the test's `waitFor` can resolve and read a stale ref.

The previous behaviour meant a flaky 1-in-N race that only surfaced under full-suite ordering (where microtask cadence shifts enough to expose it). With `flushSync` the post-await state transitions commit synchronously inside the same React tick that resolves the action promise, so descendants' effects fire before any observer (test or production) can see a half-state.

## Consequences

### Positive

- The integration gate is non-flaky. N=55 clean runs across three Vitest orderings.
- The route guard observes the same synchronous commit, so the `<FirstRunState />` / `<LoadingState />` / placeholder surface is consistent across both production and test consumers.
- FR-005a / FR-002a invariants preserved (the `await` boundary stays in front of the state transition).
- Sentinel's reproduction confirms the fix on the exact ordering that previously reproduced the flake.

### Negative / follow-ups

- `flushSync` is generally discouraged for performance reasons. The credential lifecycle actions are user-initiated and infrequent; the synchronous commit is acceptable. A future contributor who adds a high-frequency state transition site (e.g. typing in the token field) should NOT wrap it in `flushSync` — the existing per-keystroke `draftToken` state stays un-flushed on purpose.
- The four state-transition sites in each of the two providers now share a small `flushSync`-wrapped pattern. A future refactor could extract a single `useCommitState` helper that encapsulates the pattern, but that's outside this ADR's scope.

## Related decisions

- `composeRouteGuardState` in `src/app/route-guard.tsx` (BSOD-174) — tightened in the same PR #106 commit (`24e8eaf`) so the gate lifts only when BOTH providers are explicitly `'ready'`. The exhaustiveness sentinel (`NonLiftGateState = Exclude<ViewState, "loading" | "first_run" | "ready">`) makes adding a new `ViewState` literal a compile-time decision rather than a silent default-to-`ready` regression.

## Inline references

This ADR is referenced from the inline doc-comments on:

- `src/app/credentials-context.tsx` — `setSessionToken`, and the credentials mount effect.
- `src/app/workspace-context.tsx` — `selectWorkspace`, and the workspace mount effect.

A future contributor chasing one of these references lands here and reads the full race trace + the reproduction evidence + the chosen fix.
