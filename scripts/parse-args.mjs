#!/usr/bin/env node
/**
 * Shared `--key=value` / `--flag` CLI argument parser for the
 * repo's Node ESM scripts (`scripts/*.mjs`).
 *
 * Three scripts (`junit-to-sonar.mjs`, `resolve-version.mjs`,
 * `resolve-docker-tags.mjs`) previously carried a byte-identical
 * copy of this function. The duplication is the first contained
 * "small copy-paste duplication" window the Broken Window Protocol
 * surfaces — the parser logic itself has no per-script variation, so
 * the one true home is here. Sibling to the scripts under `scripts/`
 * (no `lib/` subdirectory because the project's top-level `.gitignore`
 * matches `lib/` for Go/C build output).
 *
 * Behaviour (preserved exactly from the per-script copies):
 *
 * - `argv` is the raw process-arguments array; positional (non-`--`)
 *   entries are dropped.
 * - `--flag` (no `=`) becomes the literal string `"true"` so callers
 *   can switch on `args["flag"] === "true"` without distinguishing
 *   "absent" from "present but false" — a script that wants a real
 *   boolean coerces the value itself (see `coerceBool` in
 *   `resolve-docker-tags.mjs`).
 * - `--key=value` becomes `{ [key]: value }` (the value is left as
 *   the raw string; numeric parsing is the caller's responsibility).
 * - The returned object's key is the bare key (no leading `--`).
 * - Empty / unknown inputs return `{}` rather than throwing — the
 *   contract every CLI invocation in this repo relies on.
 *
 * Tests cover this surface via the per-script re-exports
 * (`tests/unit/scripts/*.test.mjs`), so callers can keep importing
 * `parseArgs` from the script they are testing while the
 * implementation lives in one place.
 *
 * @example
 *   parseArgs(["--input=in.xml", "--output=out.xml", "--flag"])
 *   // => { input: "in.xml", output: "out.xml", flag: "true" }
 *
 * @param {readonly string[]} argv
 *   Raw CLI arguments, e.g. `process.argv.slice(2)`. Defaults to `[]`.
 * @returns {Record<string, string>}
 *   Flat key/value map of the recognised `--key=value` and `--flag`
 *   entries. Positional arguments are dropped.
 */
export function parseArgs(argv = []) {
  return Object.fromEntries(
    argv.flatMap((arg) => {
      if (!arg.startsWith("--")) return [];
      const [, body] = arg.split(/^--/, 2);
      const eqIndex = body.indexOf("=");
      if (eqIndex === -1) {
        return [[body, "true"]];
      }
      return [[body.slice(0, eqIndex), body.slice(eqIndex + 1)]];
    }),
  );
}
