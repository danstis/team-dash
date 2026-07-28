# T045 Settings credentials panel — Visual QA evidence

This folder holds the visual-QA artefacts the **Settings credentials
panel** (Spec Kit task T045 / issue BSOD-173) ships with. The
artefacts are required by the Release/Link Steward's merge-readiness
sweep — the follow-up to PR #86's `not-merge-ready` verdict flagged
"missing UI screenshots / visual QA notes (required for UI
changes)". The expanded 7-state set is the response to the Squad
Coordinator's follow-up asking for the retest success/failure
outcomes and the replace-flow capture alongside the four
confirmation/empty-state captures.

## Contents

| File                                    | Captured view-state                                                                                                                                                       | Contract pinned                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `01-initial-first-run.png`              | Provider reports ViewState = `first_run`, mode = `null`. Four empty fieldsets; storage-mode buttons hidden; Clear-all rendered.                                           | FR-001 first-run credential entry surface.                                                |
| `02-retest-success.png`                 | Retest outcome element carries `role="status" aria-live="polite"` and renders "Token valid. Authenticated as <name>."                                                     | FR-004 success branch.                                                                    |
| `03-retest-failure.png`                 | Retest outcome renders "Invalid token. Asana rejected the credential." (MSW override forces 401).                                                                         | FR-004 specific-failure-reason contract.                                                  |
| `04-replace-flow-after.png`             | Post-replace panel — masked identifier updated to the replacement token's last-4 characters, mode stays session, prior persistent record deleted synchronously (FR-005a). | FR-005 + FR-005a; note Replace is a single-step action (no confirmation dialog per spec). |
| `05-persistent-confirmation-dialog.png` | `data-testid="persistent-confirmation"` open (FR-003 disclosure: "sensitive / encrypt / this device"/"this browser profile").                                             | FR-003 + FR-006.                                                                          |
| `06-clear-all-confirmation-dialog.png`  | `data-testid="clear-all-confirmation"` open (FR-007 disclosure: single-`db.transaction` wipe).                                                                            | FR-007.                                                                                   |
| `07-persistent-mode-loaded.png`         | `mode = "persistent"`, decrypted CredentialRecord on mount (FR-002a), Switch to session-only rendered.                                                                    | FR-002a.                                                                                  |
| `README.md`                             | This file.                                                                                                                                                                |                                                                                           |

## Why no Replace-confirmation dialog?

The spec mandates an FR-003 disclosure gate for switching INTO
persistent storage and an FR-007 confirmation gate for the full
single-transaction wipe. The Replace action (FR-005) is a single-step
write — the only safety rail is the FR-005a immediate prior-record
deletion (provider's primary-key `db.credentials.delete("persistent")`
runs before the session-mode state update). The visual-QA capture
documents the post-replace panel rather than an intermediate
confirmation surface because no such surface exists in the design.

## How the artefacts were generated

1. **`tests/visual-qa-dump.test.tsx`** — renders the panel in each of
   the seven documented view-states using the same jsdom + RTL + MSW +
   fake-indexeddb environment the integration tests use. Writes the
   raw rendered DOM to `.multica/visual-qa/<label>.html`. The test
   is intentionally a capture script (always-passes assertion) rather
   than a contract test — the contract is pinned separately in
   `tests/integration/credentials/settings-panel.test.tsx` (13/13).
2. **`scripts/generate-visual-qa-pngs.mjs`** — Node ESM script that
   composes each captured HTML into a styled document and renders it
   to PNG via Playwright + the preinstalled Chromium
   (`/home/dan/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`).
   Output: the seven PNGs in this folder.
3. **`docs/visual-qa/*.png`** — the PNGs copied to a version-controlled
   location so the visual-QA evidence travels with the branch.

## Reproducibility

```bash
# 1. Capture the raw DOM for each state.
npx vitest run tests/visual-qa-dump.test.tsx
# 2. Render the captured DOM into styled PNGs.
node scripts/generate-visual-qa-pngs.mjs
# 3. Copy the rendered PNGs into the docs folder so the branch
#    carries the artefacts.
cp .multica/visual-qa/*.png docs/visual-qa/
```

## Accessibility contract the captures also pin

- The panel root carries `<section aria-label="Settings credentials panel">` semantic role.
- Both confirmation dialogs carry `role="alertdialog"` + `aria-describedby` per the WAI-ARIA Authoring Practices.
- The Retest outcome element carries `role="status" aria-live="polite"` so a screen reader announces Retest results without stealing focus.
- The Replace fieldset uses `<label>` markup so the input receives its accessible name via the implicit `<label>` association; both inputs are `type="password" autoComplete="off" spellCheck={false}` to defeat browser autofill / spellcheck bleed-through.
- The buttons are all `type="button"` so a stray Enter inside a fieldset never submits a non-existent parent form.

## Contract coverage

The visual-QA captures mirror the contract asserted by
`tests/integration/credentials/settings-panel.test.tsx` (13/13
passing) and the unit suite the Fix Engineer added at
`tests/unit/features/credentials/SettingsCredentialsPanel.test.tsx`.
Every state captured here corresponds to one or more of the test
scenarios in those suites.

## Out-of-scope follow-ups

- T046 (route guard) is not yet wired — the panel is reachable as a feature component but not yet linked from `/settings` in the production router.
- T042 (`StorageModeSelector`) and T044 (`MaskedToken`) primitives the issue description mentions are separate Phase 3 rows the panel composes equivalent inline UI for.
