/**
 * Shared masked-token presentation primitive. It accepts only the
 * already-computed `maskedIdentifier`; FR-008 requires that plaintext tokens
 * never cross this prop boundary.
 *
 * The `••••` sentinel for tokens of four characters or fewer is rendered
 * verbatim, suppressing the normal ellipsis so it is never doubled.
 */
import type { ReactElement } from "react";

/**
 * The canonical "short token" sentinel the upstream
 * `maskTokenIdentifier` returns when the plaintext token is four
 * characters or fewer (the algorithm switches to a fixed `••••`
 * because the last-four rule would otherwise echo the entire token).
 * Hard-coded here rather than imported from the data layer so this
 * component has no dependency on `src/data/**` and the rendering
 * layer stays presentation-only.
 */
const SHORT_TOKEN_SENTINEL = "••••";

/**
 * The leading horizontal-ellipsis prefix the canonical mask uses
 * for the normal "last four characters" case. Centralised as a
 * constant so the integration test
 * (`tests/integration/credentials/token-masking.test.tsx`) and the
 * existing Settings panel render agree on the exact character.
 */
const ELLIPSIS_PREFIX = "\u2026";

/**
 * The default `aria-label` explaining the masked nature of the
 * rendered identifier. Australian-English copy per the project
 * documentation convention (constitution §"Documentation"). The
 * wording is intentionally descriptive ("masked token identifier
 * showing last four characters") so a screen reader does not
 * vocalise the raw `…abcd` as a typo or an emoji.
 */
const DEFAULT_ARIA_LABEL =
  "Masked token identifier showing last four characters";

/**
 * The default `data-testid` test-query hook. Stable across the
 * surface so the existing integration test
 * (`tests/integration/credentials/token-masking.test.tsx`) and any
 * future consumer agree on the same anchor.
 */
const DEFAULT_TEST_ID = "masked-token";

/**
 * The default `className` so the component is rendered with a
 * BEM-shaped hook a stylesheet can target without each consumer
 * having to wire its own className. Callers may override via the
 * `className` prop.
 */
const DEFAULT_CLASS_NAME = "td-masked-token";

/**
 * The public props surface of `<MaskedToken />`. The component is
 * the T044 / BSOD-172 deliverable — it takes the already-computed
 * masked identifier (the canonical
 * `maskTokenIdentifier` / `maskedIdentifierFor` algorithm's output,
 * stored on the credentials context as `maskedIdentifier`) and
 * renders it as a single `<code>` element with a leading ellipsis
 * prefix, the short-token sentinel rendered verbatim, and an
 * honest, accessible `aria-label` describing the masked nature of
 * the identifier.
 */
export interface MaskedTokenProps {
  /**
   * The masked identifier computed by the canonical algorithm
   * (T040's `maskTokenIdentifier` or the feature-layer
   * `maskedIdentifierFor`). The component owns the *rendering* of
   * this string; it does NOT derive one from a plaintext token.
   * The convention for the canonical "last four characters" case
   * is the last four characters of the plaintext (e.g. `"7z9k"`).
   * The convention for the short-token case (token ≤ 4 chars) is
   * the literal `••••` sentinel.
   */
  readonly maskedIdentifier: string;
  /**
   * Optional CSS class forwarded to the rendered `<code>` element
   * so a feature can decorate the surface without the component
   * having to know about its caller. Defaults to
   * `"td-masked-token"` so the surface is styleable out of the
   * box.
   */
  readonly className?: string;
  /**
   * Optional `data-testid` override for feature-level test queries.
   * Defaults to `"masked-token"` so the existing integration test
   * settles on the same anchor every consumer agrees on.
   */
  readonly "data-testid"?: string;
  /**
   * Optional `aria-label` override. Defaults to a copy that
   * explains the masked nature of the identifier so a screen
   * reader does not vocalise the raw `…abcd` as a typo or an
   * emoji. A caller-supplied override is honoured verbatim.
   */
  readonly "aria-label"?: string;
}

/**
 * The shared masked-token display component. Renders the canonical
 * `…<lastFour>` form for the normal case, the short-token sentinel
 * `••••` verbatim for the short-token case, and nothing at all for
 * the empty / first-run case. The component is the centralised
 * rendering layer so the Settings panel, the future route guard's
 * first-run surface, and any other consumer agree on the exact
 * character the user sees.
 *
 * The component is exported as a named function for parity with
 * the other shared primitives (`FirstRunState`, `EmptyState`, …) the
 * module pattern documents.
 */
export function MaskedToken({
  maskedIdentifier,
  className,
  "data-testid": dataTestId,
  "aria-label": ariaLabel,
}: Readonly<MaskedTokenProps>): ReactElement | null {
  if (maskedIdentifier.length === 0) {
    // First-run / post-clear: there is no token to mask, so the
    // rendered surface MUST be empty. A stray `…` would be
    // confusing UX and would render an identifier-shaped placeholder
    // where none exists.
    return null;
  }

  const renderedText =
    maskedIdentifier === SHORT_TOKEN_SENTINEL
      ? maskedIdentifier
      : `${ELLIPSIS_PREFIX}${maskedIdentifier}`;

  return (
    <code
      className={className ?? DEFAULT_CLASS_NAME}
      data-testid={dataTestId ?? DEFAULT_TEST_ID}
      aria-label={ariaLabel ?? DEFAULT_ARIA_LABEL}
    >
      {renderedText}
    </code>
  );
}
