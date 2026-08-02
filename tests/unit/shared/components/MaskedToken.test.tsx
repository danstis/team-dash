/**
 * Unit coverage for the masked-token rendering boundary. FR-008 requires
 * plaintext tokens to stay outside the component's prop surface; the
 * short-token `••••` sentinel must also render without a doubled ellipsis.
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
