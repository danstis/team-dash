# Team Dash theme (BSOD-356)

A light/dark design system for team-dash: an Asana-adjacent, clean, modern
look built entirely from CSS custom properties, applied to every page that
exists today, with a documented vision for the charts BSOD-128 (P1 phases
3–7 and P2 phases 8–12) will add.

Source: `src/styles/tokens.css` (tokens) and `src/styles/global.css` (base
styles + component theming). Read those files' docstrings for the
mechanics; this doc explains the _decisions_ and the _why_.

## Why Asana-adjacent, not Asana-identical

The product reports on Asana workloads, so a jarring, unrelated visual
language would undercut user trust ("does this thing actually understand
my Asana data?"). The brief asked for "not radically different… does not
have to be the same." Concretely, this theme borrows Asana's _structural_
habits — a light, mostly-white/near-white surface with soft warm-gray
borders, generous whitespace, pill-shaped secondary chrome, one confident
accent color rather than a rainbow of button colors — without copying
Asana's actual brand assets or hex values.

## Typography

**Inter Variable**, self-hosted via `@fontsource-variable/inter`, falling
back to `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue",
Arial, sans-serif`.

- **Free and self-hosted, not a CDN link.** `index.html`'s CSP is
  `style-src 'self'` with no `font-src` override (so it inherits
  `default-src 'self'`) — a `<link>` to Google Fonts would be blocked, and
  even if it weren't, an external font request contradicts the app's
  local-first, no-third-party-network-calls posture (this is a PWA meant to
  work offline). `@fontsource-variable/inter` ships the woff2 files inside
  the npm package; Vite bundles them as same-origin build assets. No CSP
  change was needed — verify with `grep -o 'https\?://[^"]*' dist/index.html
dist/assets/*.css` after a build; only `https://app.asana.com` (the
  existing `connect-src` allowance) should appear.
- **Variable font, weight axis only** (`wght.css`, roman only — no italic,
  no optical-size axis) keeps the payload to one file per Unicode range
  instead of one file per static weight. Only the range(s) the rendered
  text actually uses are fetched (`unicode-range` is what makes this
  lazy — an en-AU install downloads the Latin + Latin-ext subsets, not all
  eight).
- **Type scale** (`--td-font-size-xs` … `--td-font-size-3xl`, `--td-space-*`
  spacing, `--td-line-height-*`) is defined once in `tokens.css` so a
  future page never invents its own font-size.
- **Monospace** (`--td-font-mono`, system stack — no separate webfont) is
  reserved for the identifier-shaped content the app already renders in
  `<code>`: `MaskedToken`, workspace names inside validated-token lists.
  Distinguishing "this is a raw value, not prose" from a monospace face is
  a small, standard affordance — it wasn't worth a second webfont.

## Light/dark strategy

Both modes are **selected**, not an automatic contrast-invert — every color
role has its own explicit dark value in `tokens.css`, matched to the dark
surface rather than computed from the light one. See
`src/styles/tokens.css`'s docstring for the exact CSS mechanics (the
`@media (prefers-color-scheme: dark)` + `:root[data-theme="dark"]`
double-declaration pattern, including the `:where(:not(...))` specificity
guard).

**No manual toggle ships in BSOD-356.** The app currently has no settings
surface with room for a "theme" control, and building one is a feature
change, not a theme design change. What ships is the _hook_: any future
toggle only has to set `document.documentElement.dataset.theme = "dark" |
"light"` (or delete the attribute to fall back to the OS preference) — the
CSS already reacts to it. Today, the app follows `prefers-color-scheme`
only.

## Color

### Neutral surfaces

Light mode uses a warm off-white page plane (`--td-color-bg: #f7f6f2`)
under pure-white cards/fieldsets (`--td-color-surface: #ffffff`) with a
soft warm-gray hairline border (`--td-color-border: #e3e1d8`) — this is the
Asana-structural habit described above: content sits on visibly distinct
white panels rather than floating directly on the page background. Dark
mode mirrors the same three-tier structure (page `#121214` → surface
`#1b1b1e` → raised surface `#232327` for dialogs) rather than flattening to
two tiers, so a confirmation dialog (`role="alertdialog"`) still reads as
elevated above the fieldset it interrupts.

### Accent

`--td-color-accent` is a warm burnt-orange/coral (`#c2410c` light,
`#fb923c` dark) — an Asana-brand-adjacent warm hue used for every primary
action (`data-variant="primary"` buttons, links, the focus-adjacent radio
accent-color) without being a literal copy of Asana's mark. Both values
were checked against their paired text/background for WCAG AA:

| Pairing                                             | Ratio  | Passes         |
| --------------------------------------------------- | ------ | -------------- |
| `#c2410c` text/fill on white surface                | 5.18:1 | AA normal text |
| `#fb923c` text on dark surface (`#121214`)          | 8.21:1 | AA normal text |
| White label on `#c2410c` button fill                | 5.18:1 | AA normal text |
| Dark-ink (`#1a0f06`) label on `#fb923c` button fill | 9.28:1 | AA normal text |

The dark-mode accent button intentionally uses **dark text on a light-orange
fill**, not white — white-on-`#fb923c` only clears 2.26:1, which fails.
This is why `--td-color-accent-contrast` is a token in its own right rather
than a hardcoded white: a future consumer must read the token, not assume
white.

### Status (success / info / warning / danger)

Four semantic roles, each with an `-icon`, `-text`, `-bg`, `-border` set.
These map onto the states the app already renders via `data-view-state`
(`src/shared/states/*`) and the `kind` discriminants on the token-test and
refresh outcome banners:

| Role    | Used for                                                                       |
| ------- | ------------------------------------------------------------------------------ |
| info    | `loading`, `first_run`, `empty`, `no_results` — nothing is wrong               |
| warning | `cached_stale`, `rate_limited`, `partial_data` — degraded, recoverable         |
| danger  | `offline`, `invalid_token`, `insufficient_permission` — blocking               |
| success | refresh `outcome-banner[data-outcome="success"]`, a `valid` token-test outcome |

**Body copy never carries the status color** — only a 4px left border, an
icon slot, and (for warning/danger) a tinted background carry the meaning;
headings and paragraphs stay in `--td-color-text-primary`. This sidesteps
most of the WCAG text-contrast burden by construction (a colored 4px
border/icon only needs the 3:1 non-text threshold, which every role here
clears by a wide margin) and matches the same "text wears text tokens,
never the status/series color" rule this project's dataviz design skill
applies to charts — worth keeping consistent since the future graphs (below)
will render right next to these banners.

The few places status color _is_ text (the token-entry/retest outcome
pills, `--td-color-*-text`) were individually contrast-checked against
their own background token — see inline comments in `tokens.css` for the
handful that needed a custom shade instead of the raw icon hex (e.g.
`--td-color-warning-text` is `#92400e` on light, not `#fab219`, because the
raw warning hex is only 1.79:1 on white).

## Applying the theme

Every current page/component already renders stable class names
(`team-dash-shell`, `td-token-entry-form`, `td-settings-credentials-panel`,
…) and `data-*` hooks (`data-view-state`, `data-outcome`,
`data-testid="outcome-banner"`) — that convention predates this issue.
`global.css` is written entirely against those existing hooks, plus one
small additive change: every `<button>` across the five credential/refresh
components now carries `data-variant="primary" | "secondary" | "danger"` so
CSS can tell a destructive action ("Clear all", "Confirm clear all") from a
primary one ("Refresh", "Test token") without guessing from DOM position.
That was the only component-level change this issue made — no JSX
structure, prop, test id, aria attribute, or behaviour changed. `npm run
lint`, `npm run typecheck`, `npm run format:check`, and the full
unit/contract/integration suite (655 tests) all pass unmodified against the
new markup.

Pages covered: the `/` first-run flow (`FirstRunSetup` → `TokenEntryForm` →
`StorageModeSelector` → `WorkspaceSelector`, plus their `alertdialog`
confirmations), `/settings` (`SettingsCredentialsPanel` and its two confirm
dialogs), the post-gate `PlaceholderRoute` shell, `RefreshControls` and its
progress/outcome banners, and all ten `ViewState` primitives in
`src/shared/states/*`.

## Future graphs vision (BSOD-128)

No chart exists in the codebase yet (`src/features/{metrics,tasks,
team-mapping,person-groups}` are still `.gitkeep` placeholders) —
`recharts` is installed but unused. `--td-chart-*` tokens in `tokens.css`
are pre-wired so the first chart consumes a validated palette instead of
inventing one; nothing below is implemented, all of it is a spec for
whoever builds phases 6–12.

The chart palette is the validated, colour-vision-deficiency-safe default
from this project's dataviz design skill — not hand-picked, and not the UI
accent color. Charts and UI chrome intentionally use _different_ color
systems: the accent orange means "click me"; chart hues mean "this is
series 3." Reusing the same hue for both would make a chart legend swatch
look like an interactive control.

| BSOD-128 story                                                              | MVP scope   | Chart form                                                                                                                                                                                                                          | Palette role                                                                                                                                                         |
| --------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| US4 — work added vs. completed over time (P1, Phase 6)                      | ✅ in scope | Two-line time series (added, completed), **one axis** — never dual-axis; if a cumulative backlog delta is also wanted, index both lines to a common base rather than a second y-scale                                               | `--td-chart-series-1` (added), `--td-chart-series-2` (completed)                                                                                                     |
| US5 — backlog size and direction (P1, Phase 7)                              | ✅ in scope | Single-series area/line with a zero-baseline; direction (growing/shrinking) as a direct label, not a color flip                                                                                                                     | `--td-chart-series-1`; the "growing vs shrinking" delta text (not the line) uses `--td-color-danger-text` / `--td-color-success-text`                                |
| US7 — per-person workload (P2, Phase 9)                                     | future      | Horizontal bar per person, sorted by load; a person is identity, not magnitude — bars are one hue (sequential), not one color per person                                                                                            | `--td-chart-sequential-100…700`                                                                                                                                      |
| US8 — completed work / on-time delivery / priority breakdown (P2, Phase 10) | future      | Priority breakdown = stacked bar (categorical, ≤4 priority tiers — Asana priorities fit under the "first three slots validate all-pairs" cap); on-time-delivery = a `good`/`warning`/`critical` status split, not a categorical hue | `--td-chart-series-1…4` for priority tiers; `--td-chart-status-*` for on-time/late/overdue                                                                           |
| US9 — estimate accuracy, blocked/stalled work (P2, Phase 11)                | future      | Estimate accuracy = diverging (over- vs under-estimated) around a zero midpoint; blocked/stalled = status badges, icon + label, never a bare color dot                                                                              | `--td-chart-series-1` (blue) ↔ `--td-chart-series-8` (red) as the diverging pair, `--td-chart-diverging-neutral` midpoint; `--td-chart-status-*` for blocked/stalled |
| US10 — task age, cycle time, data-quality gaps (P2, Phase 12)               | future      | Age/cycle time = sequential heatmap or histogram (one hue, light→dark = young→old); data-quality gaps = a `warning`/`danger` badge list, not a chart                                                                                | `--td-chart-sequential-*`                                                                                                                                            |

Rules that carry over from the dataviz skill and apply to every chart
above, regardless of which phase builds it:

- **Categorical hues are assigned in fixed order and never cycled** — a 9th
  series folds into "Other" or gets faceted, it does not generate a new
  hue.
- **One axis, always.** Two measures of different scale become two charts
  or an indexed-to-a-common-base line, never a second y-axis.
- **Re-run the skill's `validate_palette.js`** before adding a series past
  the third slot in any all-pairs chart form (scatter, bubble, small
  multiples) — the categorical order here validates all eight adjacent-pair
  hard gates, but only the first three clear the stricter all-pairs floor.
- **Dark mode gets its own validated step**, not an automatic invert — the
  `--td-chart-*` dark values above are already the skill's dark-surface
  steps, not a CSS `filter: invert()` of the light ones.
- Every multi-series chart ships a legend (never color-only identity), a
  table-view fallback, and hover/tooltip interaction per the skill's
  `interaction.md` — none of that is theme-layer work, it's chart-component
  work for whichever phase lands first (most likely US4, since it's next
  in the P1 stage order after US3).

When the first chart lands, re-read the dataviz skill in full rather than
treating this table as sufficient on its own — it only records the
palette/form _decisions_, not the mark-spec, spacer, or interaction rules a
real implementation needs.
