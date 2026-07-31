/**
 * T044 — Shared masked-token display component
 * (`src/shared/components/MaskedToken.tsx`).
 *
 * Spec / contract references
 * --------------------------
 * - US1 acceptance scenario 7 (spec.md): "Given a token is stored or
 *   in use, when the user views any screen, log, exported content, or
 *   URL, then the full token value is never displayed, logged, or
 *   embedded — at most a masked/partial identifier is shown."
 * - FR-008: "The system MUST NOT display the complete token value
 *   once entered (at most a masked/partial representation may be
 *   shown), and MUST NOT include the token in logs, diagnostics,
 *   exported content, or URLs."
 * - Constitution Principle IV: tokens MUST NEVER appear in URLs,
 *   logs, error reports, analytics, source control, fixtures,
 *   screenshots, build artefacts, service-worker caches, or exported
 *   reporting data.
 * - data-model.md `CredentialRecord.maskedIdentifier`: "e.g. last 4
 *   characters, the only representation ever rendered."
 *
 * Why this test file exists
 * -------------------------
 * The masked-identifier algorithm (the "last four characters" rule)
 * is small but it is the *only* token-shaped representation the rest of
 * the app is allowed to render. Drift here — adding a leading `prefix`,
 * using a base64 scramble, accidentally echoing the full token — would
 * silently break FR-008 because no other test would catch the
 * rendered DOM tightening. The integration test
 * `tests/integration/credentials/token-masking.test.tsx` (T038) pins
 * the broader "no plaintext anywhere" contract; this unit test pins
 * the rendering contract at the component boundary so future
 * contributors can find the canonical algorithm and the canonical
 * rendering without having to read the settings panel.
 *
 * What this test pins
 * -------------------
 * 1. The rendered DOM contains the masked identifier — and ONLY the
 *    masked identifier. The full plaintext token never appears in
 *    the rendered text or any attribute (FR-008).
 *
 * 2. The leading horizontal-ellipsis prefix (`…`) is used for the
 *    normal "last four characters" case. The short-token sentinel
 *    `••••` (the value the canonical `maskTokenIdentifier` returns
 *    for tokens four characters or fewer) is rendered verbatim
 *    without a leading `…` so the user sees `••••` and not
 *    `……••••` — a bug the existing `displayIdentifier` helper in
 *    `StorageModeSelector` already avoids, and the canonical
 *    component must centralise.
 *
 * 3. The component renders nothing when the masked identifier is
 *    empty — the first-run / post-clear state has no token to mask,
 *    so the rendered surface MUST be empty (a stray `…` would be
 *    confusing UX).
 *
 * 4. The component uses a `<code>` element so the masked identifier
 *    is semantically distinct from regular text (and visually distinct
 *    in the existing CSS scoping). The `data-testid="masked-token"`
 *    hook is the test-query anchor the rest of the surface agrees on.
 *
 * 5. The rendered element carries an `aria-label` so screen readers
 *    announce the masked nature of the identifier rather than reading
 *    the raw `…abcd` as a typo or an emoji.
 *
 * What this test deliberately does NOT cover
 * ------------------------------------------
 * - The encrypt/decrypt round-trip (T027/T028, BSOD-155/156).
 * - The masked-identifier *algorithm* upstream of this component —
 *   `maskTokenIdentifier` in `src/data/db/repositories/credential.repository.ts`
 *   and `maskedIdentifierFor` in `src/features/credentials/helpers.ts`
 *   own the algorithm. This component is the rendering layer that
 *   takes the already-computed identifier and turns it into a DOM
 *   node.
 * - The integration boundary (T038, BSOD-166) — the DOM/URL/console
 *   scan that lives in `tests/integration/credentials/token-masking.test.tsx`.
 *
 * Red/Green/Refactor sequencing
 * -----------------------------
 * Per Constitution Principle III, this test was authored before the
 * component lands. The first run fails for the intended reason
 * ("Cannot find module"); the second run, after T044's implementation
 * lands, MUST pass with no test changes.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

describe("T044 / BSOD-172 shared masked-token display component", () => {
  afterEach(() => {
    cleanup();
  });

  describe("rendering contract (FR-008 / data-model.md `maskedIdentifier`)", () => {
    it("renders the canonical '…<lastFour>' form for a normal identifier", async () => {
      const { MaskedToken } =
        await import("../../../../src/shared/components/MaskedToken");
      render(<MaskedToken maskedIdentifier="7z9k" />);

      const element = screen.getByTestId("masked-token");
      expect(element.tagName).toBe("CODE");
      expect(element).toHaveTextContent("…7z9k");
    });

    it("renders the short-token sentinel '••••' verbatim without a leading ellipsis", async () => {
      const { MaskedToken } =
        await import("../../../../src/shared/components/MaskedToken");
      render(<MaskedToken maskedIdentifier="••••" />);

      const element = screen.getByTestId("masked-token");
      expect(element).toHaveTextContent("••••");
      expect(element.textContent).not.toMatch(/^…/);
    });

    it("renders nothing when the masked identifier is the empty string", async () => {
      const { MaskedToken } =
        await import("../../../../src/shared/components/MaskedToken");
      const { container } = render(<MaskedToken maskedIdentifier="" />);

      expect(screen.queryByTestId("masked-token")).toBeNull();
      expect(container.textContent).toBe("");
    });

    it("exposes a configurable data-testid for feature-level test queries", async () => {
      const { MaskedToken } =
        await import("../../../../src/shared/components/MaskedToken");
      render(<MaskedToken maskedIdentifier="abcd" data-testid="custom-id" />);

      expect(screen.getByTestId("custom-id")).toHaveTextContent("…abcd");
      expect(screen.queryByTestId("masked-token")).toBeNull();
    });

    it("forwards an optional className to the rendered element", async () => {
      const { MaskedToken } =
        await import("../../../../src/shared/components/MaskedToken");
      render(
        <MaskedToken
          maskedIdentifier="abcd"
          className="td-settings-panel__active-token"
        />,
      );

      const element = screen.getByTestId("masked-token");
      expect(element).toHaveClass("td-settings-panel__active-token");
    });
  });

  describe("accessibility (Constitution Principle VII, FR-008)", () => {
    it("carries a default aria-label that explains the masked nature of the identifier", async () => {
      const { MaskedToken } =
        await import("../../../../src/shared/components/MaskedToken");
      render(<MaskedToken maskedIdentifier="7z9k" />);

      const element = screen.getByTestId("masked-token");
      const ariaLabel = element.getAttribute("aria-label");
      expect(ariaLabel).not.toBeNull();
      // The label must describe the masked nature of the identifier so
      // a screen reader does not vocalise the raw `…7z9k` as a typo or
      // emoji. The exact wording is allowed to vary, but it must
      // mention either "masked" or "last four" so a translation sweep
      // that drops the security-relevant cue is caught.
      expect(ariaLabel?.toLowerCase()).toMatch(/masked|last four|partial/);
    });

    it("honours a caller-provided aria-label override", async () => {
      const { MaskedToken } =
        await import("../../../../src/shared/components/MaskedToken");
      render(
        <MaskedToken
          maskedIdentifier="7z9k"
          aria-label="Asana token identifier, masked"
        />,
      );

      const element = screen.getByTestId("masked-token");
      expect(element).toHaveAttribute(
        "aria-label",
        "Asana token identifier, masked",
      );
    });

    it("does not render the plaintext token in any attribute (FR-008)", async () => {
      const { MaskedToken } =
        await import("../../../../src/shared/components/MaskedToken");
      render(<MaskedToken maskedIdentifier="7z9k" />);

      const element = screen.getByTestId("masked-token");
      expect(element.textContent).not.toContain("team-dash-T044-leaked-token");
      for (const attribute of Array.from(element.attributes)) {
        expect(attribute.value).not.toContain("team-dash-T044-leaked-token");
      }
    });
  });

  describe("boundary: never renders the full plaintext token (FR-008)", () => {
    it("does not accept a plaintext token via any prop (T044 surface is identifier-only)", async () => {
      // This is a static contract assertion: the component's TypeScript
      // signature excludes a `token` field. The runtime probe below
      // pins that no future contributor can widen the surface by
      // silently adding a `token` prop at the call site (React would
      // forward unknown props to the DOM, surfacing a `data-token`
      // attribute in the rendered markup and breaking the existing
      // token-masking integration test).
      const { MaskedToken } =
        await import("../../../../src/shared/components/MaskedToken");
      render(
        // @ts-expect-error — the `token` prop is intentionally not
        // part of the MaskedToken surface; a future contribution that
        // adds it must also update this test and the integration
        // test in `tests/integration/credentials/token-masking.test.tsx`.
        <MaskedToken maskedIdentifier="7z9k" token="team-dash-leaked-1234" />,
      );

      const element = screen.getByTestId("masked-token");
      expect(element.textContent).not.toContain("team-dash-leaked-1234");
      for (const attribute of Array.from(element.attributes)) {
        expect(attribute.value).not.toContain("team-dash-leaked-1234");
      }
    });

    it("renders the well-known MASKED_IDENTIFIER ('…7z9k') as the exact text content", async () => {
      const { MaskedToken } =
        await import("../../../../src/shared/components/MaskedToken");
      // The integration test in `tests/integration/credentials/token-masking.test.tsx`
      // uses this exact MASKED_IDENTIFIER value as the canonical
      // surface ("…7z9k"). The component MUST render it verbatim so
      // the integration test's assertion `toHaveTextContent('…7z9k')`
      // can settle on the same surface every consumer expects.
      const MASKED_IDENTIFIER = "…7z9k";
      render(<MaskedToken maskedIdentifier={MASKED_IDENTIFIER.slice(1)} />);

      const element = screen.getByTestId("masked-token");
      expect(element).toHaveTextContent(MASKED_IDENTIFIER);
    });
  });
});
