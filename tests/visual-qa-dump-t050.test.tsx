/**
 * Visual-QA DOM capture: render the T050 cached-reload surface
 * (`FreshnessBanner` + `OfflineRefreshState`) in each of the documented
 * view-states via the same jsdom + RTL environment the integration
 * tests use, and dump the rendered HTML to
 * `.multica/visual-qa/t050-<label>.html`.
 *
 * This is a one-shot capture, not a normal test — it always passes
 * because the assertions are merely "the DOM contains a banner /
 * offline state". The capture exists so the Spec Kit / Multica
 * workflow can attach the resulting HTML files + the PNG screenshots
 * the `scripts/generate-visual-qa-t050-pngs.mjs` step produces to the
 * T050 PR as the documented visual-QA evidence required by the
 * Release/Link Steward's `not-merge-ready` verdict on PR #147
 * ("Missing UI Evidence: … lacks screenshots or visual QA notes for
 * the new UI components").
 *
 * Run: `npx vitest run tests/visual-qa-dump-t050.test.tsx`
 */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { type ReactElement, StrictMode } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

import {
  FreshnessBanner,
  OfflineRefreshState,
} from "../src/features/refresh/FreshnessBanner";

const OUTPUT_DIR = resolve(process.cwd(), ".multica/visual-qa");

async function ensureOutputDir(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
}

async function dump(label: string, container: HTMLElement): Promise<void> {
  await writeFile(
    resolve(OUTPUT_DIR, `t050-${label}.html`),
    container.innerHTML,
    "utf8",
  );
}

/**
 * Override `navigator.onLine` for the lifetime of a capture block.
 * Returns a teardown that restores the previous value so a
 * per-block `setNavigatorOnline` cannot leak into a later block.
 */
function setNavigatorOnline(value: boolean): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(
    window.navigator,
    "onLine",
  );
  Object.defineProperty(window.navigator, "onLine", {
    value,
    configurable: true,
    writable: true,
  });
  return () => {
    if (descriptor === undefined) {
      delete (window.navigator as { onLine?: boolean }).onLine;
      return;
    }
    Object.defineProperty(window.navigator, "onLine", descriptor);
  };
}

const FIXED_REFRESHED_AT = "2026-07-31T09:42:18.000Z";
const SECOND_REFRESHED_AT = "2026-07-31T09:51:02.000Z";

describe("T050 cached-reload surface — visual-QA DOM capture", () => {
  beforeAll(async () => {
    await ensureOutputDir();
  });

  afterAll(() => {
    cleanup();
  });

  it("captures every documented T050 view-state into .multica/visual-qa/t050-*.html", async () => {
    // ------------------------------------------------------------------------
    // State 1: FreshnessBanner — cached variant (FR-021).
    // ------------------------------------------------------------------------
    cleanup();
    {
      const { container } = render(
        <StrictMode>
          <FreshnessBanner
            lastRefreshedAt={FIXED_REFRESHED_AT}
            isCached={true}
          />
        </StrictMode>,
      );
      expect(
        container.querySelector("[data-testid='freshness-banner']"),
      ).not.toBeNull();
      await dump("01-freshness-cached", container);
    }

    // ------------------------------------------------------------------------
    // State 2: FreshnessBanner — fresh variant (FR-021).
    // ------------------------------------------------------------------------
    cleanup();
    {
      const { container } = render(
        <StrictMode>
          <FreshnessBanner
            lastRefreshedAt={SECOND_REFRESHED_AT}
            isCached={false}
          />
        </StrictMode>,
      );
      expect(
        container.querySelector("[data-testid='freshness-banner']"),
      ).not.toBeNull();
      await dump("02-freshness-fresh", container);
    }

    // ------------------------------------------------------------------------
    // State 3: OfflineRefreshState — online (button enabled, no explanation).
    // ------------------------------------------------------------------------
    cleanup();
    {
      const restoreNavigator = setNavigatorOnline(true);
      try {
        const { container } = render(
          <StrictMode>
            <OfflineRefreshState onRefresh={() => {}} />
          </StrictMode>,
        );
        expect(
          container.querySelector("[data-testid='offline-refresh-state']"),
        ).not.toBeNull();
        await dump("03-offline-refresh-online", container);
      } finally {
        restoreNavigator();
      }
    }

    // ------------------------------------------------------------------------
    // State 4: OfflineRefreshState — offline (button disabled + explanation).
    // FR-087: refresh is unavailable offline; cached dashboard remains visible.
    // ------------------------------------------------------------------------
    cleanup();
    {
      const restoreNavigator = setNavigatorOnline(false);
      try {
        const { container } = render(
          <StrictMode>
            <OfflineRefreshState onRefresh={() => {}} />
          </StrictMode>,
        );
        expect(
          container.querySelector("[data-testid='offline-explanation']"),
        ).not.toBeNull();
        await dump("04-offline-refresh-offline", container);
      } finally {
        restoreNavigator();
      }
    }

    // ------------------------------------------------------------------------
    // State 5: Combined surface — cached banner + offline refresh.
    // The realistic US2 dashboard surface after a reload while offline.
    // ------------------------------------------------------------------------
    cleanup();
    {
      const restoreNavigator = setNavigatorOnline(false);
      try {
        const { container } = render(
          <StrictMode>
            <FreshnessBanner
              lastRefreshedAt={FIXED_REFRESHED_AT}
              isCached={true}
            />
            <OfflineRefreshState onRefresh={() => {}} />
          </StrictMode>,
        );
        expect(
          container.querySelector("[data-testid='freshness-banner']"),
        ).not.toBeNull();
        expect(
          container.querySelector("[data-testid='offline-explanation']"),
        ).not.toBeNull();
        await dump("05-combined-cached-and-offline", container);
      } finally {
        restoreNavigator();
      }
    }

    // ------------------------------------------------------------------------
    // State 6: Transition online → offline.
    // Captures the post-transition disabled state after the live
    // `window` `offline` event fires.
    // ------------------------------------------------------------------------
    cleanup();
    {
      const restoreNavigator = setNavigatorOnline(true);
      try {
        const { container } = render(
          <StrictMode>
            <OfflineRefreshState onRefresh={() => {}} />
          </StrictMode>,
        );
        // Initial online: button enabled, no explanation.
        expect(
          container.querySelector("[data-testid='offline-explanation']"),
        ).toBeNull();
        // Fire the offline event to drive the state machine.
        act(() => {
          window.dispatchEvent(new Event("offline"));
        });
        expect(
          container.querySelector("[data-testid='offline-explanation']"),
        ).not.toBeNull();
        await dump("06-transition-online-to-offline", container);
      } finally {
        restoreNavigator();
      }
    }

    // ------------------------------------------------------------------------
    // State 7: Transition offline → online.
    // Captures the post-reconnection enabled state, used as evidence
    // the event-driven contract the integration tests pin.
    // ------------------------------------------------------------------------
    cleanup();
    {
      const restoreNavigator = setNavigatorOnline(false);
      try {
        const { container } = render(
          <StrictMode>
            <OfflineRefreshState onRefresh={() => {}} />
          </StrictMode>,
        );
        expect(
          container.querySelector("[data-testid='offline-explanation']"),
        ).not.toBeNull();
        restoreNavigator();
        const restoreNavigator2 = setNavigatorOnline(true);
        try {
          act(() => {
            window.dispatchEvent(new Event("online"));
          });
          expect(
            container.querySelector("[data-testid='offline-explanation']"),
          ).toBeNull();
          await dump("07-transition-offline-to-online", container);
        } finally {
          restoreNavigator2();
        }
      } finally {
        // restoreNavigator already returned; this is a no-op.
      }
    }

    // Confirm every expected artefact is on disk so the PNG generator
    // downstream can pick them up. The same expected-artifact list
    // is documented in docs/visual-qa/README-t050.md.
    const expectedArtifacts = [
      "t050-01-freshness-cached.html",
      "t050-02-freshness-fresh.html",
      "t050-03-offline-refresh-online.html",
      "t050-04-offline-refresh-offline.html",
      "t050-05-combined-cached-and-offline.html",
      "t050-06-transition-online-to-offline.html",
      "t050-07-transition-offline-to-online.html",
    ];
    expect(await readdir(OUTPUT_DIR)).toEqual(
      expect.arrayContaining(expectedArtifacts),
    );
  });
});

// Reference `fireEvent` so the import is not flagged unused in case
// future states need to drive the click handler for additional
// captures (e.g. the T051 failure-reason rendering).
void fireEvent;
void (null as ReactElement | null);
