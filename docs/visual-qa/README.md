# T045 Settings credentials panel — Visual QA evidence

This folder holds the visual-QA artefacts the **Settings credentials
panel** (Spec Kit task T045 / issue BSOD-173) ships with. The artefacts
are required by the Release/Link Steward's merge-readiness sweep — the
follow-up to PR #86's `not-merge-ready` verdict flagged "missing UI
screenshots / visual QA notes (required for UI changes)".

## Contents

| File                                    | Purpose                                                                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-initial-first-run.png`              | Panel rendered with no credential stored (ViewState = `first_run`, mode = `null`).                                                                    |
| `02-session-after-set-token.png`        | Panel after a successful `setSessionToken` (mode = `session`, state = `ready`).                                                                       |
| `03-persistent-confirmation-dialog.png` | `data-testid="persistent-confirmation"` open after clicking _Switch to persistent_ (FR-003 disclosure copy visible).                                  |
| `04-clear-all-confirmation-dialog.png`  | `data-testid="clear-all-confirmation"` open after clicking _Clear all_ (FR-007 disclosure copy visible).                                              |
| `05-persistent-mode-loaded.png`         | Panel rendered with a pre-decrypted persistent row in IndexedDB — `Switch to session-only` rendered in place of _Set token_ / _Switch to persistent_. |
| `README.md`                             | This file.                                                                                                                                            |

## How the artefacts were generated

1. **`tests/visual-qa-dump.test.tsx`** — renders the panel in each of
   the five documented view-states using the same jsdom + RTL + MSW +
   fake-indexeddb environment the integration tests use. Writes the
   raw rendered DOM to `.multica/visual-qa/<label>.html` and a JSON
   wrapper (HTML + ARIA-role summary + story summary) to
   `.multica/visual-qa/<label>.json`. The test is intentionally a
   capture script (always-passes assertion) rather than a contract test
   — the contract is pinned separately in
   `tests/integration/credentials/settings-panel.test.tsx`.
2. **`scripts/generate-visual-qa-pngs.mjs`** — Node ESM script that
   composes each captured HTML into a styled document and renders it
   to PNG via Playwright + the
   `/home/dan/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`
   binary that ships with the repo's Playwright install. Output: the
   five PNGs in this folder.
3. **`docs/visual-qa/*.png`** — the PNGs copied to a version-controlled
   location so the visual-QA evidence travels with the branch.

## Reproducibility

```
# 1. Install Chromium for Playwright (chromium-1228 is preinstalled
#    in the project's ~/.cache/ms-playwright/ on this sandbox).
# 2. Capture the raw DOM for each state.
npx vitest run tests/visual-qa-dump.test.tsx
# 3. Render the captured DOM into styled PNGs.
node scripts/generate-visual-qa-pngs.mjs
```

## Contract coverage

The visual-QA captures mirror the contract asserted by
`tests/integration/credentials/settings-panel.test.tsx` (13/13 passing
on PR #86 head SHA `22dd206`). Every state captured here corresponds
to one or more of the test scenarios below:

- _Initial_ ↔ "renders the first-run primitive and hides the reporting surface when no credential and no workspace are set" (T035 / first-run.test.tsx, red until T046).
- _Session-after-set-token_ ↔ "transitions credentials to 'ready' but leaves workspace in 'first_run' when only a session token is set" (T035) and T037 retest / replace happy-paths.
- _Persistent-confirmation_ ↔ T037 "switching from session-only to persistent requires an explicit confirmation (FR-003)".
- _Clear-all-confirmation_ ↔ T037 "removes the credential record and wipes every Dexie store in one transaction".
- _Persistent-mode-loaded_ ↔ T037 "switching from persistent back to session-only immediately deletes the encrypted record (FR-005a)".

## Accessibility contract the captures also pin

- The panel root carries `role` semantics via `<section aria-label="Settings credentials panel" data-view-state="settings">` (the test ids stay stable across rebuilds).
- Both confirmation dialogs carry `role="alertdialog"` + `aria-describedby` per the WAI-ARIA Authoring Practices.
- The Retest outcome element carries `role="status" aria-live="polite"` so a screen reader announces Retest results without stealing focus.
- The Replace fieldset uses `<label>` markup so the input receives its accessible name via the implicit `<label>` association; both inputs are `type="password" autoComplete="off" spellCheck={false}` to defeat browser autofill / spellcheck bleed-through.
- The buttons are all `type="button"` so a stray Enter inside a fieldset never submits a non-existent parent form.

## Out-of-scope follow-ups

- T046 (route guard) is not yet wired — the panel is reachable as a feature component but not yet linked from `/settings` in the production router.
- T042 (`StorageModeSelector`) and T044 (`MaskedToken`) primitives the issue description mentions are separate Phase 3 rows the panel composes equivalent inline UI for.
