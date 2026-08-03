/**
 * Visual-QA DOM capture: render the T050 cached-reload surface
 * (`FreshnessBanner`) in each of the documented view-states via the
 * same jsdom + RTL environment the integration tests use, and dump
 * the rendered HTML to `.multica/visual-qa/t050-<label>.html`.
 *
 * This is a one-shot capture, not a normal test — it always passes
 * because the assertions are merely "the DOM contains a banner".
 * The capture exists so the Spec Kit / Multica workflow can attach
 * the resulting HTML files + the PNG screenshots the
 * `scripts/generate-visual-qa-t050-pngs.mjs` step produces to the
 * T050 PR as the documented visual-QA evidence required by the
 * Release/Link Steward's `not-merge-ready` verdict on PR #147
 * ("Missing UI Evidence: … lacks screenshots or visual QA notes for
 * the new UI components").
 *
 * ## Merge note (T050 reconciliation)
 *
 * Main's T050 implementation (PR #148) shipped a `FreshnessBanner`
 * with an `isCached: boolean` prop and a co-located
 * `OfflineRefreshState` component. The merge resolution adopted
 * M001's pure-renderer design for `FreshnessBanner` (which derives
 * fresh/cached from elapsed time + clock injection) and dropped
 * `OfflineRefreshState` (T03's `<RefreshControls />` already gates
 * refresh offline via `useOffline()` + `<OfflineState />`). This
 * test is updated to use the new M001 API and the offline-state
 * captures are removed; the pre-merge PNG artifacts in
 * `docs/visual-qa/t050-*.png` remain as historical evidence of the
 * pre-merge T050 surface.
 *
 * Run: `npx vitest run tests/visual-qa-dump-t050.test.tsx`
 */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { type ReactElement, StrictMode } from "react";
import { cleanup, render } from "@testing-library/react";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

import { FreshnessBanner } from "../src/features/refresh/FreshnessBanner";

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

// `now` is pinned so the fresh-vs-cached derivation is
// deterministic across runs. The four fixture timestamps are spaced
// across the 30-second `FRESH_BANNER_WINDOW_MS` threshold so the
// captures exercise both variants without `Date.now()` mocking.
const FIXED_NOW_MS = Date.parse("2026-07-31T09:42:00.000Z");
const fixedNow = (): Date => new Date(FIXED_NOW_MS);

const RECENT_REFRESHED_AT = new Date(FIXED_NOW_MS - 5_000).toISOString(); // 5 s ago → fresh
const STALE_REFRESHED_AT = new Date(FIXED_NOW_MS - 15 * 60 * 1000).toISOString(); // 15 min ago → cached

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
    // 15-min-old timestamp → elapsed > 30 s threshold → cached.
    // ------------------------------------------------------------------------
    cleanup();
    {
      const { container } = render(
        <StrictMode>
          <FreshnessBanner
            lastRefreshedAt={STALE_REFRESHED_AT}
            now={fixedNow}
          />
        </StrictMode>,
      );
      expect(
        container.querySelector("[data-testid='freshness-banner']"),
      ).not.toBeNull();
      expect(
        container.querySelector("[data-freshness='cached']"),
      ).not.toBeNull();
      await dump("01-freshness-cached", container);
    }

    // ------------------------------------------------------------------------
    // State 2: FreshnessBanner — fresh variant (FR-021).
    // 5-second-old timestamp → elapsed < 30 s threshold → fresh.
    // ------------------------------------------------------------------------
    cleanup();
    {
      const { container } = render(
        <StrictMode>
          <FreshnessBanner
            lastRefreshedAt={RECENT_REFRESHED_AT}
            now={fixedNow}
          />
        </StrictMode>,
      );
      expect(
        container.querySelector("[data-testid='freshness-banner']"),
      ).not.toBeNull();
      expect(
        container.querySelector("[data-freshness='fresh']"),
      ).not.toBeNull();
      await dump("02-freshness-fresh", container);
    }

    // Confirm the artefacts for the surviving T050 surface are on
    // disk so the PNG generator downstream can pick them up. The
    // pre-merge T050 captures (03-04 for offline, 05-07 for
    // transitions) live in `docs/visual-qa/t050-*.png` on the
    // merged branch as historical evidence; the dynamic test only
    // exercises the post-merge surface.
    const expectedArtifacts = [
      "t050-01-freshness-cached.html",
      "t050-02-freshness-fresh.html",
    ];
    expect(await readdir(OUTPUT_DIR)).toEqual(
      expect.arrayContaining(expectedArtifacts),
    );
  });
});

// Reference `ReactElement` so the import is not flagged unused in
// case future states need a wrapper element for additional captures.
void (null as ReactElement | null);
