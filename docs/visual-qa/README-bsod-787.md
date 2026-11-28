# BSOD-787 reporting controls — Visual QA evidence

These captures show the real `ReportingPeriodControl` and `FilterPillBar` in the dashboard masthead and filter strip. The capture harness composes those components with the same `td-dashboard__*` shell markup and uses `describeValue` from the real filter model for the scope line. The workspace name, current time, and oldest cached activity are fixed fixture values; this is a component render, not a screenshot of a signed-in Asana workspace.

| Files                                                                     | View                              | Contract shown                                                                                                                                                                             |
| ------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bsod-787-desktop-default.png`, `bsod-787-narrow-default.png`             | Default reporting window          | The masthead control, scope line, and date-range pill say “Last 90 days” (FR-092).                                                                                                         |
| `bsod-787-desktop-all-time.png`, `bsod-787-narrow-all-time.png`           | All time selected                 | The control, scope line, and pill say “All time”; no `1 Jan 1000` sentinel is rendered (FR-091).                                                                                           |
| `bsod-787-desktop-custom-editor.png`, `bsod-787-narrow-custom-editor.png` | Custom range opened from All time | The editor pre-fills From with the oldest activity date, `2025-01-10`, and To with the fixed anchor date, `2026-03-15`. The uncommitted editor leaves the masthead and pill on “All time.” |

Desktop captures use a 1280 × 720 viewport. Narrow captures use 390 × 760. The renderer writes full-page PNGs, so the tall custom editor remains visible. The narrow capture exposed a wrapped period label and an over-wide select; the scoped `td-dashboard__period-label` / `td-dashboard__period-select` sizing change keeps the control compact without horizontal overflow or header overlap. The renderer checks both conditions at each viewport and state.

## How to reproduce

```bash
npx vitest run tests/visual-qa-dump-bsod-787.test.tsx
npm run build
node scripts/generate-visual-qa-bsod-787-pngs.mjs
```

The capture test renders the React components in jsdom, interacts with the period control and date-range editor, and writes the resulting DOM to `.multica/visual-qa/bsod-787-*.html`. Its serialization preserves the selected form values. The PNG renderer loads the app's built CSS from `dist/assets`, renders the captured DOM in Playwright with the preinstalled Chromium, and writes the six PNGs in this folder. The behavior behind the states is covered separately by `tests/unit/features/filters/filter-model.test.ts` and `tests/integration/dashboard/dashboard-shell.test.tsx`.
