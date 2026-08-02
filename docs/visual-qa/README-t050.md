# T050 cached-reload surface — Visual QA evidence

This folder holds the visual-QA artefacts the **T050 cached-reload
surface** (Spec Kit task T050 / issue BSOD-304) ships with. The
artefacts are required by the Release/Link Steward's merge-readiness
sweep — PR #147's `not-merge-ready` verdict flagged "Missing UI
Evidence: … lacks screenshots or visual QA notes for the new UI
components (`FreshnessBanner` / `OfflineRefreshState`)" alongside the
merge-conflict and branch-name blockers. The 7-state set is the
response to the Release Steward's request for visual evidence the
cached-reload UX surfaces correctly across every documented state.

## Contents

| File                                       | Captured view-state                                                                                                                                                                                                      | Contract pinned                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `t050-01-freshness-cached.png`             | `FreshnessBanner` with `isCached=true`. Heading "Showing cached data"; timestamp verbatim; copy names the data may not reflect recent changes.                                                                           | FR-021 cached variant.                                         |
| `t050-02-freshness-fresh.png`              | `FreshnessBanner` with `isCached=false`. Heading "Showing fresh data"; same timestamp surface; up-to-date copy replaces the cached-state wording.                                                                        | FR-021 fresh variant.                                          |
| `t050-03-offline-refresh-online.png`       | `OfflineRefreshState` with `navigator.onLine=true`. Refresh button enabled; no offline explanation.                                                                                                                      | FR-087 online branch.                                          |
| `t050-04-offline-refresh-offline.png`      | `OfflineRefreshState` with `navigator.onLine=false`. Refresh button `disabled` + `aria-disabled="true"`; explanation: "Refresh is unavailable while you're offline. Your last cached dashboard remains available below." | FR-087 offline branch (button visibly disabled + explanation). |
| `t050-05-combined-cached-and-offline.png`  | Combined surface: `FreshnessBanner` (cached) + `OfflineRefreshState` (offline). Realistic US2 dashboard render on a reload while offline.                                                                                | FR-021 + FR-087 composed on the same render tree.              |
| `t050-06-transition-online-to-offline.png` | `OfflineRefreshState` mounting online, then a `window` `offline` event fires; the same render tree flips to disabled + explanation without a remount.                                                                    | Event-driven transition (FR-087).                              |
| `t050-07-transition-offline-to-online.png` | `OfflineRefreshState` mounting offline (button disabled + explanation), then a `window` `online` event fires; the same render tree re-enables the button.                                                                | Event-driven reconnection (FR-087).                            |
| `README-t050.md`                           | This file.                                                                                                                                                                                                               |                                                                |

## Accessibility contract the captures also pin

- The banner root carries `<section role="status" aria-live="polite" aria-label="Showing cached data | Showing fresh data">` so a screen reader announces the cached-vs-fresh transition without stealing focus.
- The `OfflineRefreshState` root carries `<section role="status" aria-live="polite" aria-label="Refresh">` so the disabled-button transition is announced as a status update.
- The Refresh button is `type="button"`, so a stray Enter inside the fieldset never submits a non-existent parent form.
- The disabled button carries `aria-disabled="true"` in addition to the native `disabled` attribute, so assistive tech announces the disabled state alongside the visible label.
- The offline explanation copy uses an em-dash (Australian English) and explicitly states the cached dashboard remains available — the user is never left wondering whether the surface is broken offline.

## How the artefacts were generated

1. **`tests/visual-qa-dump-t050.test.tsx`** — renders the
   `FreshnessBanner` and `OfflineRefreshState` in each of the seven
   documented view-states using the same jsdom + RTL environment the
   integration tests use. Writes the raw rendered DOM to
   `.multica/visual-qa/t050-<label>.html`. The test is intentionally a
   capture script (always-passes assertion) rather than a contract
   test — the contract is pinned separately in
   `tests/integration/refresh/cached-reload.test.tsx` (7/7).
2. **`scripts/generate-visual-qa-t050-pngs.mjs`** — Node ESM script
   that composes each captured HTML into a styled document and
   renders it to PNG via Playwright + the preinstalled Chromium
   (`/home/dan/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`).
   Output: the seven PNGs in this folder.
3. **`docs/visual-qa/t050-*.png`** — the PNGs in this version-
   controlled location so the visual-QA evidence travels with the
   branch.

## Reproducibility

```bash
# 1. Capture the raw DOM for each state.
npx vitest run tests/visual-qa-dump-t050.test.tsx
# 2. Render the captured DOM into styled PNGs.
node scripts/generate-visual-qa-t050-pngs.mjs
```

The PNG generator writes to `docs/visual-qa/t050-*.png` directly (the
T050 path differs from the T045 `.multica/visual-qa/*.png` sink so a
T045 regression does not overwrite the T050 captures).

## Contract coverage

The visual-QA captures mirror the contract asserted by
`tests/integration/refresh/cached-reload.test.tsx` (7/7 passing on
the head SHA at the time of the merge-readiness sweep):

| Integration test case                                                              | PNG counterpart                            |
| ---------------------------------------------------------------------------------- | ------------------------------------------ |
| `labels cached data as cached and surfaces the last-refreshed timestamp`           | `t050-01-freshness-cached.png`             |
| `labels fresh data as fresh and surfaces the same timestamp`                       | `t050-02-freshness-fresh.png`              |
| `renders the refresh action enabled while online and shows no offline explanation` | `t050-03-offline-refresh-online.png`       |
| `disables the refresh action and explains why when the browser is offline`         | `t050-04-offline-refresh-offline.png`      |
| (combined surface; not a separate test case but documents the realistic render)    | `t050-05-combined-cached-and-offline.png`  |
| `re-enables the refresh action when the browser comes back online`                 | `t050-07-transition-offline-to-online.png` |
| `re-disables the refresh action when the browser goes offline after mount`         | `t050-06-transition-online-to-offline.png` |

## Out-of-scope follow-ups

- T053 (BSOD-307) PWA / service-worker wiring is the row that turns
  the offline branch into a real cache-served surface. The PNG
  captures document the React component contract; the eventual PWA
  wiring will mount the same `OfflineRefreshState` unchanged because
  the component reads `navigator.onLine` directly rather than
  coupling to the cache strategy.
- T051 (BSOD-305) orchestrator failure-reason accounting will surface
  a `partial_failure` outcome via the `RefreshControls` (T049) sibling
  banner, not via `FreshnessBanner`. The captures here deliberately
  stay inside the FR-021 / FR-087 surface T050 owns.
