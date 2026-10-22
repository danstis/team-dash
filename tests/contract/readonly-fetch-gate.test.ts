/**
 * BSOD-468 — the read-only outbound gate (FR-009 / NFR-004).
 *
 * The Asana client at `src/data/asana/client.ts` is the single
 * legitimate outbound call site in the app, and it is read-only by
 * construction. `eslint.config.js` enforces that by restricting the
 * global `fetch` outside `src/data/asana/**`
 * (`no-restricted-globals`, with `checkGlobalObject` so the
 * `window.fetch` / `globalThis.fetch` / `self.fetch` spellings are
 * covered too).
 *
 * A lint rule that no test ever exercises can be dropped by a future
 * refactor of the flat config without anybody noticing, and the
 * read-only guarantee would silently revert to "holds by luck". This
 * file therefore lints probe sources through the repository's *real*
 * ESLint configuration and asserts the gate behaves as specified:
 *
 * 1. A `fetch(...)` call anywhere under `src/` outside the Asana client
 *    module is an error — bare `fetch`, and the member-access
 *    spellings that a bare-reference check would miss.
 * 2. The same source under `src/data/asana/client.ts` is clean, so the
 *    one legitimate call site keeps working.
 *
 * The gate itself lives in the lint config (the issue's Option A); this
 * file is the backstop that proves the gate is wired up.
 */

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/** Rule id that carries the read-only guarantee in `eslint.config.js`. */
const GATE_RULE_ID = "no-restricted-globals";

/** The message the gate reports, so a failure points at the fix. */
const GATE_MESSAGE_HINT = "src/data/asana/client.ts";

/**
 * A probe module that tries to issue a write request straight from
 * application code — the exact regression the gate exists to stop. It
 * would mutate the user's live Asana workspace with their full-scope
 * personal access token if it ever shipped.
 */
const BARE_FETCH_PROBE = `export async function probe(): Promise<void> {
  await fetch("https://example.com", { method: "POST" });
}
`;

/**
 * The member-access spellings. `no-restricted-globals` reports a bare
 * reference to the global, so `window.fetch(...)` would slip past it
 * unless the gate also enables `checkGlobalObject`.
 */
const GLOBAL_OBJECT_FETCH_PROBE = `export async function probe(): Promise<void> {
  await window.fetch("https://example.com", { method: "POST" });
  await globalThis.fetch("https://example.com", { method: "POST" });
  await self.fetch("https://example.com", { method: "POST" });
}
`;

/**
 * One ESLint instance for the whole file: constructing it resolves the
 * repository's flat config from disk, so every probe below is linted
 * with the configuration CI actually runs.
 */
const eslint = new ESLint({ cwd: process.cwd() });

/**
 * Lint a probe source as if it lived at `filePath`, returning the
 * reported messages. `lintText` lints source that is not on disk, so
 * no fixture file has to be written to disk (and left behind) to
 * exercise the gate.
 */
async function lintProbe(
  source: string,
  filePath: string,
): Promise<Awaited<ReturnType<ESLint["lintText"]>>[number]["messages"]> {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages;
}

describe("BSOD-468 read-only outbound gate (FR-009, NFR-004)", () => {
  it("rejects a bare `fetch` call under `src/` outside the Asana client module", async () => {
    const messages = await lintProbe(BARE_FETCH_PROBE, "src/features/probe.ts");

    const gateMessages = messages.filter(
      (message) => message.ruleId === GATE_RULE_ID,
    );

    expect(
      gateMessages.length,
      "Expected the read-only gate to reject `fetch` under src/features, " +
        `but ESLint reported: ${JSON.stringify(messages)}`,
    ).toBeGreaterThan(0);
    expect(gateMessages[0]?.message).toContain(GATE_MESSAGE_HINT);
  });

  it("rejects `window.fetch` / `globalThis.fetch` / `self.fetch` under `src/` outside the Asana client module", async () => {
    const messages = await lintProbe(
      GLOBAL_OBJECT_FETCH_PROBE,
      "src/features/probe.ts",
    );

    const gateMessages = messages.filter(
      (message) => message.ruleId === GATE_RULE_ID,
    );

    expect(
      gateMessages.length,
      "Expected the read-only gate to reject the global-object spellings " +
        `of \`fetch\`, but ESLint reported: ${JSON.stringify(messages)}`,
    ).toBe(GLOBAL_OBJECT_FETCH_PROBE.match(/fetch\(/g)?.length ?? 0);
    expect(gateMessages[0]?.message).toContain(GATE_MESSAGE_HINT);
  });

  it("keeps the one legitimate call site — `src/data/asana/client.ts` — clean", async () => {
    const messages = await lintProbe(
      BARE_FETCH_PROBE,
      "src/data/asana/client.ts",
    );

    expect(
      messages.filter((message) => message.ruleId === GATE_RULE_ID),
      "The Asana client is the single legitimate outbound call site and " +
        `must stay exempt from the gate, but ESLint reported: ${JSON.stringify(messages)}`,
    ).toEqual([]);
  });
});
