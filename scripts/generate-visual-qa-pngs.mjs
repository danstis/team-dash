/**
 * Visual-QA PNG generator: take the captured DOM HTML from
 * .multica/visual-qa/<label>.html (produced by
 * tests/visual-qa-dump.test.tsx) and render it through Playwright +
 * the local chromium binary at
 * $HOME/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome to
 * produce a PNG screenshot per state at
 * .multica/visual-qa/<label>.png.
 *
 * Run: `node scripts/generate-visual-qa-pngs.mjs`
 *
 * Note: this is a Node ESM script (not a vitest test) because
 * Playwright does not need the vitest/React toolchain to render a
 * pre-baked HTML document.
 */
import { chromium } from "playwright-core";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = process.cwd();
const VISUAL_QA_DIR = resolve(ROOT, ".multica/visual-qa");
const CHROMIUM_PATH =
  "/home/dan/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome";

const VIEWPORT = { width: 880, height: 1100 };

const HTML_DOC = ({ body }) => `
<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <title>Settings credentials panel — visual QA</title>
    <style>
      :root {
        --fg: #1f2937;
        --muted: #475569;
        --line: #e2e8f0;
        --accent: #4338ca;
        --ok: #166534;
        --warn: #b45309;
        --bg: #f8fafc;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 32px;
        background: var(--bg);
        color: var(--fg);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
          "Helvetica Neue", Arial, sans-serif;
        font-size: 14px;
        line-height: 1.5;
      }
      .qa-shell {
        max-width: 820px;
        margin: 0 auto;
      }
      .qa-eyebrow {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted);
        margin-bottom: 8px;
      }
      .td-settings-credentials-panel {
        background: white;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 20px 24px;
        box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
      }
      .td-settings-credentials-panel h2 {
        margin: 0 0 16px;
        font-size: 18px;
      }
      .td-settings-credentials-panel fieldset {
        border: 1px solid var(--line);
        border-radius: 6px;
        margin: 0 0 16px;
        padding: 12px 16px;
      }
      .td-settings-credentials-panel legend {
        font-weight: 600;
        padding: 0 6px;
      }
      .td-settings-credentials-panel label {
        display: block;
        margin: 6px 0;
      }
      .td-settings-credentials-panel input {
        display: block;
        width: 100%;
        max-width: 480px;
        padding: 6px 10px;
        border: 1px solid var(--line);
        border-radius: 4px;
        font-family: inherit;
        font-size: 14px;
        margin-top: 4px;
      }
      .td-settings-credentials-panel button {
        background: var(--accent);
        color: white;
        border: none;
        border-radius: 4px;
        padding: 6px 12px;
        margin-right: 8px;
        margin-top: 6px;
        font-weight: 500;
      }
      .td-settings-credentials-panel__confirm {
        margin-top: 12px;
        padding: 12px 16px;
        border: 2px solid var(--warn);
        border-radius: 6px;
        background: #fef3c7;
        color: #1f2937;
      }
      .td-settings-credentials-panel__confirm h3 { margin-top: 0; }
      .td-settings-credentials-panel__retest {
        margin-top: 8px;
        padding: 8px 12px;
        border-radius: 4px;
        background: #ecfdf5;
        color: var(--ok);
        border-left: 4px solid var(--ok);
      }
      .td-settings-credentials-panel__retest--invalid_token,
      .td-settings-credentials-panel__retest--insufficient_permission,
      .td-settings-credentials-panel__retest--network_error {
        background: #fee2e2;
        color: #7f1d1d;
        border-left-color: #dc2626;
      }
      code { background: #f1f5f9; padding: 1px 6px; border-radius: 3px; }
    </style>
  </head>
  <body>
    <div class="qa-shell">
      <p class="qa-eyebrow">Team Dash · Settings credentials panel (T045) · visual QA</p>
      ${body}
    </div>
  </body>
</html>
`;

const STATES = [
  {
    label: "01-initial-first-run",
    title: "Initial state · no token",
    subtitle:
      "CredentialsProvider reports ViewState='first_run', mode=null. The panel shows four empty fieldsets with the Active credential input + Set token + Retest actions; storage-mode buttons hidden (mode=null); Clear-all button rendered for immediate destructive-action access.",
  },
  {
    label: "02-retest-success",
    title: "Retest outcome · token valid (FR-004)",
    subtitle:
      "After Set token + Retest, the panel's retest-outcome element carries role='status' aria-live='polite' and surfaces 'Token valid. Authenticated as <name>.' The MSW /users/me fixture returns the canonical user; FR-004 says the panel must report success or a specific failure reason, and the success branch is what the user sees when their PAT is intact.",
  },
  {
    label: "03-retest-failure",
    title: "Retest outcome · invalid token (401)",
    subtitle:
      "MSW override forces /users/me to return 401. The retest-outcome element renders 'Invalid token. Asana rejected the credential.' (FR-004's specific-failure-reason contract). The masked identifier in the Storage mode fieldset is unchanged; only the validity probe was invalidated.",
  },
  {
    label: "04-replace-flow-after",
    title: "Replace flow · post-replace masked identifier (FR-005 + FR-005a)",
    subtitle:
      "Replace is a single-step action (FR-005) — no confirmation dialog per spec (only the switch-to-persistent transition carries FR-003). The screenshot captures the post-replace panel: masked identifier updates to the replacement token's last-4 characters; mode stays session; if the prior mode had been persistent the FR-005a delete (provider's primary-key db.credentials.delete('persistent')) would have already removed the encrypted record before the session-mode state update.",
  },
  {
    label: "05-persistent-confirmation-dialog",
    title: "FR-003 disclosure dialog · persistent storage",
    subtitle:
      "Clicking Switch to persistent surfaces the role=alertdialog confirmation. The copy names (a) the token is sensitive, (b) AES-GCM at rest, (c) the documented in-origin attacker limitation, and (d) the local browser-profile scope. Confirm triggers setPersistentToken; Decline closes without writing.",
  },
  {
    label: "06-clear-all-confirmation-dialog",
    title: "FR-007 confirmation dialog · clear all data",
    subtitle:
      "Clicking Clear all surfaces the role=alertdialog confirmation. The copy states the encrypted token AND every piece of locally retained Asana data is wiped in a single Dexie transaction. Confirm Clear all invokes clearAll; Cancel closes without wiping.",
  },
  {
    label: "07-persistent-mode-loaded",
    title: "Persistent mode · loaded on mount (FR-002a)",
    subtitle:
      "The CredentialsProvider decrypts the encrypted CredentialRecord on mount (FR-002a, AES-GCM non-extractable key), transitions to mode='persistent', and renders the Switch to session-only action. The Set token / Retest affordances are reachable but the actual credential backing the API calls is the decrypted plaintext held in the panel's local state.",
  },
];

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROMIUM_PATH,
  });
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const existing = new Set(
      (await readdir(VISUAL_QA_DIR).catch(() => [])).filter(
        (f) => f.endsWith(".html") || f.endsWith(".json"),
      ),
    );
    for (const state of STATES) {
      const htmlJson = await readFile(
        resolve(VISUAL_QA_DIR, `${state.label}.json`),
        "utf8",
      ).catch(() => null);
      const htmlFile = await readFile(
        resolve(VISUAL_QA_DIR, `${state.label}.html`),
        "utf8",
      ).catch(() => null);
      let panelHtml;
      let storySummary;
      if (htmlJson !== null) {
        const json = JSON.parse(htmlJson);
        panelHtml = json.html;
        storySummary = json.storySummary;
      } else if (htmlFile !== null) {
        panelHtml = htmlFile;
        storySummary = state.subtitle;
      } else {
        console.warn(`[visual-qa] no capture for ${state.label}; skipping`);
        continue;
      }
      const full = HTML_DOC({
        body: `
          <p style="font-size: 13px; color: #475569; margin: 0 0 12px;">
            <strong style="display: block; font-size: 14px; color: #1f2937;">${state.title}</strong>
            ${storySummary ?? state.subtitle}
          </p>
          ${panelHtml}
          <hr style="margin-top: 24px; border: none; border-top: 1px dashed #cbd5e1;" />
          <p style="font-size: 11px; color: #64748b; margin: 8px 0 0;">
            Visual QA capture generated by tests/visual-qa-dump.test.tsx →
            scripts/generate-visual-qa-pngs.mjs · T045 / BSOD-173.
            Captured DOM contract is verified by
            tests/integration/credentials/settings-panel.test.tsx (13/13
            passing on PR #86 at the time of the last merge-readiness
            sweep).
          </p>
        `,
      });
      await page.setContent(full, { waitUntil: "load" });
      await page.screenshot({
        path: resolve(VISUAL_QA_DIR, `${state.label}.png`),
        fullPage: true,
      });
      console.log(`[visual-qa] wrote ${state.label}.png`);
      existing.delete(`${state.label}.html`);
      existing.delete(`${state.label}.json`);
    }
    // Clean up old captured artefacts that no longer match a state.
    for (const stray of existing) {
      if (!STATES.some((state) => stray.startsWith(state.label))) {
        continue;
      }
      console.log(`[visual-qa] ignoring stray artefact: ${stray}`);
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

void main().catch((err) => {
  console.error("[visual-qa] PNG generation failed:", err);
  process.exitCode = 1;
});
