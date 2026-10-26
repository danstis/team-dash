---
name: Team Dash
description: A private, read-only briefing room for one team leader's Asana workload and backlog.
colors:
  kiln-orange: "#c2410c"
  kiln-orange-hover: "#9a3412"
  kiln-orange-active: "#7c2d12"
  kiln-orange-dark: "#fb923c"
  kiln-orange-dark-contrast: "#1a0f06"
  kiln-wash: "#fce9de"
  kiln-wash-border: "#f3c7ac"
  focus-blue: "#2a78d6"
  paper: "#f7f6f2"
  surface: "#ffffff"
  hairline: "#e3e1d8"
  hairline-strong: "#c9c6ba"
  ink: "#17171a"
  graphite: "#55565c"
  pewter: "#83848c"
  night-paper: "#121214"
  night-surface: "#1b1b1e"
  night-raised: "#232327"
  night-hairline: "#2f2f34"
  night-ink: "#f4f4f2"
  success-icon: "#0ca30c"
  success-text: "#006300"
  success-bg: "#e6f6e6"
  info-icon: "#2a78d6"
  info-text: "#1d4ed8"
  info-bg: "#e8f1fc"
  warning-icon: "#fab219"
  warning-text: "#92400e"
  warning-bg: "#fef3d6"
  danger-icon: "#d03b3b"
  danger-text: "#d03b3b"
  danger-bg: "#fbe7e7"
  danger-border: "#f0b8b8"
  chart-series-1: "#2a78d6"
  chart-series-2: "#eb6834"
  chart-series-3: "#1baf7a"
  chart-series-4: "#eda100"
  chart-series-5: "#e87ba4"
  chart-series-6: "#008300"
  chart-series-7: "#4a3aa7"
  chart-series-8: "#e34948"
  chart-sequential-100: "#cde2fb"
  chart-sequential-400: "#3987e5"
  chart-sequential-700: "#0d366b"
typography:
  display:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.2
    fontFeature: '"cv11" 1'
  headline:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.2
  subtitle:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.5
  caption:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "0.9em"
    fontWeight: 400
rounded:
  sm: "6px"
  md: "10px"
  lg: "16px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
components:
  button-primary:
    backgroundColor: "{colors.kiln-orange}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.kiln-orange-hover}"
    textColor: "{colors.surface}"
  button-primary-active:
    backgroundColor: "{colors.kiln-orange-active}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.danger-text}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  button-danger-hover:
    backgroundColor: "{colors.danger-bg}"
    textColor: "{colors.danger-text}"
  input-text:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    width: "34rem"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "24px"
  status-banner-warning:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "24px"
  status-banner-danger:
    backgroundColor: "{colors.danger-bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "24px"
  outcome-pill-valid:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.success-text}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "24px"
  nav-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.kiln-orange}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
---

# Design System: Team Dash

## Overview

**Creative North Star: "The Briefing Room"**

Team Dash is the table the team leader sits at before walking into their manager's office. Everything on it is prepared, labelled and defensible. The system is calm and paper-like: a warm off-white page, plain white panels edged with a warm-gray hairline, near-black ink, and one confident warm accent for the action that matters. Nothing decorates. The visual job is to make numbers, freshness and scope legible at a glance, and to keep them legible as a screenshot pasted into someone else's slide.

The density is that of a working document, not a cockpit. Panels have generous internal padding (24px), type follows a modest scale anchored on a 16px body, and state (loading, cached, offline, failed) always shows as a labelled banner, never as a silent colour change. The look is Asana-adjacent rather than Asana-identical. It borrows Asana's structural habits (a light surface, soft warm borders, pill-shaped secondary chrome, a single accent) so the data reads as familiar to an Asana user, but it never copies Asana's brand assets or hex values.

Both light and dark themes are designed separately, not auto-inverted. Every role has its own dark value, chosen against the dark surface and contrast-checked to WCAG AA.

**Key Characteristics:**

- Warm paper page, white panels, warm-gray hairlines: a three-tier tonal structure in both themes.
- One accent (Kiln Orange) reserved for primary actions and links.
- Status is carried by a 4px left rule, an icon and a tinted wash. Body text stays ink.
- Flat at rest. The only shadow belongs to dialogs that interrupt the page.
- Charts use a separate, validated palette that never borrows the UI accent.

## Colors

A warm-neutral paper palette with a single fired-orange accent, a separate status vocabulary, and a separate colour-vision-safe chart palette.

### Primary

- **Kiln Orange** (#c2410c light / #fb923c dark): primary buttons, links, the radio accent and hover emphasis on navigation. Hover deepens to #9a3412 and active to #7c2d12. In dark mode the button label flips to Kiln Char (#1a0f06), because white on #fb923c fails contrast.
- **Kiln Wash** (#fce9de, border #f3c7ac): the subtle accent tint behind inline `code` and text selection.

### Secondary

- **Focus Blue** (#2a78d6 light / #3987e5 dark): reserved for the keyboard focus ring and focused-input border. It is never an action colour, so focus can't be confused with "primary".

### Neutral

- **Paper** (#f7f6f2): the page plane; also the disabled-input fill and the secondary-button hover.
- **Surface** (#ffffff): panels, fieldsets, inputs, banners.
- **Hairline** (#e3e1d8) / **Hairline Strong** (#c9c6ba): panel edges / control edges.
- **Ink** (#17171a): headings, body, every piece of text that carries meaning.
- **Graphite** (#55565c): labels, secondary text, progress copy.
- **Pewter** (#83848c): muted metadata, hover border on neutral controls.
- **Night Paper / Night Surface / Night Raised** (#121214 / #1b1b1e / #232327): the dark-theme equivalents of the three tiers; Night Raised is for dialogs.
- **Night Ink** (#f4f4f2): dark-theme primary text.

### Status

Each status role has an `-icon` (border/glyph, 3:1 floor), a `-text` shade checked separately for 4.5:1, a `-bg` wash and a `-border`.

- **Success**: refresh succeeded, token valid.
- **Info**: loading, first run, empty, no results. Nothing is wrong.
- **Warning**: cached/stale, rate-limited, partial data. Degraded but recoverable.
- **Danger**: offline, invalid token, insufficient permission. Blocking.

### Chart palette

Eight categorical hues in fixed order (blue, orange, aqua, yellow, magenta, green, violet, red), a blue sequential ramp, a diverging neutral and four status steps. All come from the dataviz skill's validated, CVD-safe palette, with separate dark-theme steps. These live as `--td-chart-*` in `src/styles/tokens.css`.

### Named Rules

**The One Voice Rule.** Kiln Orange marks the action to take or a link, and nothing else. It never fills a chart series, a status, or a decorative block.

**The Ink Stays Ink Rule.** Text never wears a status or series colour except in the small outcome pills, which use the separately contrast-checked `-text` shades. Meaning lives in the rule, icon and wash, not in coloured paragraphs.

**The Two Palettes Rule.** UI chrome and charts are separate colour systems. A legend swatch must never look like a button.

## Typography

**Body Font:** Inter Variable (self-hosted via `@fontsource-variable/inter`, falling back to system-ui)
**Label/Mono Font:** the system monospace stack, used only for raw identifiers

**Character:** One neutral, highly legible grotesque doing all the work at a small number of weights. Inter's `cv11` single-storey alternates are always on, which makes digits and the "a" read cleanly in dense figures.

### Hierarchy

- **Display** (600, 2.25rem, 1.2): page titles (h1).
- **Headline** (600, 1.75rem, 1.2): section titles (h2) and state-banner headings.
- **Title** (600, 1.375rem, 1.2): sub-sections, dialog titles (h3).
- **Subtitle** (600, 1.125rem, 1.2): h4 and fieldset legends.
- **Body** (400, 1rem, 1.6 for paragraphs, 1.5 elsewhere): prose and control text. Form fields cap at 34rem.
- **Label** (500, 0.875rem): field labels in Graphite, buttons (at 600), navigation pills, status pills.
- **Caption** (400, 0.75rem): smallest metadata.
- **Mono** (0.9em, system mono): masked tokens and other raw values, on a Kiln Wash chip.

### Named Rules

**The Single Family Rule.** Inter for everything. Monospace appears only where content is literally a raw value. No display face and no CDN fonts: the CSP is `self` only, and the app must work offline.

## Layout

A single centred column, max 72rem (`--td-content-width-shell`), with 16px side padding below 640px and 32px above. First-run and form-led screens narrow to 34rem. Spacing runs on a 4px base (4, 8, 12, 16, 24, 32, 48). Stacked panels sit 24px apart, panels pad 24px inside, and headings carry 16px below. Headers use a wrapping flex row (title left, controls right) that collapses gracefully on narrow screens. The layout is desktop-first because that's where the work happens, but it holds without horizontal scroll at phone width.

## Elevation & Depth

Depth comes from tonal layering, not shadow: paper page → white panel → (in dark mode) a lifted raised surface. Panels and banners are flat, defined only by their hairline. Two shadows exist.

### Shadow Vocabulary

- **Hairline lift** (`box-shadow: 0 1px 2px rgba(15, 15, 12, 0.06)`): available for small elements that need separation from a same-tone background. Use sparingly.
- **Interruption** (`box-shadow: 0 8px 24px rgba(15, 15, 12, 0.1)`): confirmation dialogs (`role="alertdialog"`) only.

### Named Rules

**The Flat Unless Interrupting Rule.** Surfaces are flat at rest. Shadow is reserved for something that stops the user and asks a question.

## Shapes

Gently rounded, never bubbly. Controls, pills and inline chips use 6px; panels, fieldsets and banners use 10px; dialogs use 16px. The fully round pill is reserved for navigation chips. Borders are 1px hairlines, with one exception: status banners carry a 4px left rule in the status's icon colour.

## Components

Refined and restrained: hairline borders, flat at rest, and only the primary action carries colour.

### Buttons

- **Shape:** gently rounded (6px), 8px × 16px padding, 0.875rem semibold label, inline-flex with an 8px icon gap.
- **Primary:** Kiln Orange fill and border, white label (Kiln Char in dark). Hover deepens, active deepens again.
- **Secondary:** white fill, Hairline Strong border, ink label; hover fills Paper.
- **Danger:** transparent fill, danger border and text; hover fills with the danger wash. Used for destructive actions ("Clear all"), never for errors.
- **Default (no variant):** same as secondary; hover darkens the border to Pewter.
- **Disabled:** 55% opacity, `not-allowed` cursor. **Busy** (`aria-busy`): 85% opacity, progress cursor.
- **Focus:** 3px Focus Blue outline, 2px offset.

### Inputs / Fields

- **Style:** white fill, 1px Hairline Strong border, 6px radius, 8px × 12px padding, full width up to 34rem. Labels sit above in 0.875rem medium Graphite.
- **Hover:** border to Pewter.
- **Focus:** border to Focus Blue plus a 3px 25% Focus Blue halo; no outline.
- **Disabled:** Paper fill, Pewter text, `not-allowed` cursor.
- **Radio:** native, tinted with Kiln Orange; a label wrapping a radio becomes a flex option row.

### Panels (fieldsets / cards)

- **Corner Style:** 10px.
- **Background:** Surface on Paper.
- **Border:** 1px Hairline.
- **Shadow Strategy:** none (see Elevation).
- **Internal Padding:** 24px; the legend is set as a 1.125rem semibold title.

### Status Banners (signature component)

The `data-view-state` banner is the app's main voice for anything that isn't ready data. It is a panel (10px, 24px padding, Hairline border) with a **4px left rule** coloured by severity. Info states keep a white fill; warning and danger states add their tinted wash. The heading and copy stay ink. The refresh outcome banner follows the same pattern at 16px padding.

### Outcome Pills

Inline, 6px radius, 8px × 12px, 0.875rem: the only place status colour is text. They use the `-text` / `-bg` / `-border` triplet (for example a valid token shows success text on the success wash). Each `-text` shade must reach 4.5:1 on its own `-bg` wash, not only on Surface. Known gap: light `--td-color-danger-text` (#d03b3b) is 4.05:1 on `--td-color-danger-bg` (see `docs/design/ux-findings.md`, F-07).

### Dialogs

Confirmation dialogs: raised surface, Hairline Strong border, 16px radius, 24px padding, Interruption shadow. They are the only elevated element in the system.

### Navigation

A compact pill (999px radius, 4px × 12px, 0.875rem medium) on Surface with a Hairline border. Hover switches the border and text to Kiln Orange. It is a stand-in until full dashboard navigation lands.

## Interaction & Copy

The visual system only holds up if behaviour matches it. These rules apply to every feature as it is wired up. Open findings against them are tracked in `docs/design/ux-findings.md`.

### Named Rules

**The Every Action Answers Rule.** Every user action ends in a visible, announced outcome (`role="status"` for success/progress, `role="alert"` for failure). A button that can't act right now is disabled with a reason next to it; it never returns silently. Closing a confirmation dialog after Confirm always shows what happened.

**The Test Before Trust Rule.** A credential is tested before it becomes active, on every surface that accepts one (first-run, Set, Replace). One shared component does the testing and one shared dialog does the persistent-storage confirmation, with identical title, copy and button labels wherever they appear.

**The Escape Cancels Rule.** Escape and Cancel close a dialog and restore the prior state. They never commit a choice or advance a flow. Multi-step flows offer a Back step, and Enter submits the step's primary action.

**The State Is One Source Rule.** Panels read live state from the providers (`useCredentials`, `useWorkspace`), never from a local copy that can disagree. After Clear all, every on-screen summary reflects the wipe without a reload.

**The Masthead Rule.** Every reporting view shows workspace, scope, date range and freshness in its header, so a screenshot stands on its own. Freshness (fresh / cached / stale / offline) is never only available on a different screen.

**The Product Voice Rule.** UI copy never contains spec or task IDs (FR-xxx, T0xx, BSOD-xxx), implementation language ("router", "provider", "wired", "bootstrapping") or raw enum values (`session` → "Session only", `persistent` → "Saved on this device"). Developer notes live in code comments. Placeholder screens still get product copy.

**The Next Step Rule.** Every error says what happened in plain words and what to do next (for example "Asana didn't accept this token. Check it was copied in full, or create a new one in Asana › Settings › Apps"). Raw browser errors ("Failed to fetch") are mapped, not passed through. Where the user must bring something from Asana (a PAT), the screen says how to get it.

**The Raw Means Raw Rule.** Monospace is for literal raw values (masked tokens, gids). Human names, such as workspaces, projects and people, are set in Inter.

## Do's and Don'ts

### Do:

- **Do** read every colour, size, radius and shadow from a `--td-*` token in `src/styles/tokens.css`; never hardcode a hex or px value in a stylesheet.
- **Do** give every new colour role an explicit, contrast-checked dark value (WCAG AA) rather than relying on inversion.
- **Do** show data freshness and degraded states with a labelled status banner (left rule + wash + ink text).
- **Do** style components through stable `td-*` classes and `data-variant` / `data-view-state` / `data-outcome` attributes, keeping component files free of styling.
- **Do** use `--td-chart-*` tokens in their fixed categorical order for charts, with one y-axis, a legend and a table fallback.
- **Do** check a new screen against the Interaction & Copy rules and `docs/design/ux-findings.md` before calling it done.
- **Do** move focus to the new step's heading when a flow advances, and make dialogs marked `aria-modal` actually inert the page behind them.

### Don't:

- **Don't** use Kiln Orange for chart series, status or decoration.
- **Don't** colour body text with a status or series hue; use the `-text` shades only inside outcome pills.
- **Don't** add shadows to panels or banners; elevation belongs to dialogs.
- **Don't** load fonts, icons or assets from a CDN; the CSP is `self` only and the app must work offline.
- **Don't** copy Asana's brand assets, logo or exact hex values.
- **Don't** put white text on the dark-theme accent; use `--td-color-accent-contrast`.
- **Don't** ship spec IDs, implementation notes or raw enum values in UI copy.
- **Don't** let a button return without an outcome, or let Escape commit a choice.
