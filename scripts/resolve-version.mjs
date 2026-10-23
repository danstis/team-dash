#!/usr/bin/env node
import process from "node:process";

import { parseArgs } from "./parse-args.mjs";
import { isSemver } from "./semver.mjs";

// Re-export the shared `parseArgs` so the per-script test
// (`tests/unit/scripts/resolve-version.test.mjs`) can keep importing it
// from this module. The single source of truth lives in
// `scripts/parse-args.mjs`.
export { parseArgs };

// The sentinel the `sonar` job has always reported when no release version
// is reachable (a branch or pull-request ref with no tag in reach).
export const DEV_VERSION = "0.0.0-dev";

const stripV = (value) => (value ? value.replace(/^v/, "") : "");

/**
 * The version candidate for the given ref context, before validation.
 *
 * A ref name is attacker-influencable text (git's own ref rules allow `$`,
 * backticks, `"`, `;`, `|`, `&`, `(` and `)`), so this value must never be
 * trusted — `resolveVersion` validates it before it is used.
 *
 * @param {{refType?: string, refName?: string, latestTag?: string}} input
 * @returns {string}
 *   The candidate version, or `""` when no version source is available.
 */
export function resolveVersionCandidate({ refType, refName, latestTag } = {}) {
  if (refType === "tag" && refName) {
    return stripV(refName);
  }
  if (latestTag) {
    return stripV(latestTag);
  }
  return "";
}

/**
 * Resolve the version for the given ref context, with the validation
 * outcome alongside it.
 *
 * BSOD-631: the resolved value is written to `$GITHUB_OUTPUT` and then
 * interpolated into the Sonar scanner arguments. Anything that is not a
 * plain semver string is rejected and replaced with the `0.0.0-dev`
 * sentinel, so a crafted ref name can neither break out of the shell block
 * nor define arbitrary step outputs.
 *
 * @param {{refType?: string, refName?: string, latestTag?: string}} input
 * @returns {{version: string, candidate: string, rejected: boolean}}
 *   `version` is the value to use, `candidate` the raw (unvalidated)
 *   version, `rejected` `true` when a candidate was present but was not a
 *   valid semver string.
 */
export function resolveVersionDetails(input = {}) {
  const candidate = resolveVersionCandidate(input);
  if (candidate === "") {
    return { version: DEV_VERSION, candidate, rejected: false };
  }
  if (isSemver(candidate)) {
    return { version: candidate, candidate, rejected: false };
  }
  return { version: DEV_VERSION, candidate, rejected: true };
}

/**
 * Resolve the version for the given ref context.
 *
 * @param {{refType?: string, refName?: string, latestTag?: string}} input
 * @returns {string}
 *   A validated semver string, or the `0.0.0-dev` sentinel when the
 *   resolved candidate is not a valid semver.
 */
export function resolveVersion(input = {}) {
  return resolveVersionDetails(input).version;
}

const isMain = import.meta.url === new URL(process.argv[1], "file://").href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const { version, candidate, rejected } = resolveVersionDetails({
    refType: args["ref-type"] ?? "",
    refName: args["ref-name"] ?? "",
    latestTag: args["latest-tag"] ?? "",
  });
  if (rejected) {
    // `JSON.stringify` keeps the reason on a single line: a rejected
    // candidate could otherwise forge extra log lines.
    process.stderr.write(
      `resolve-version: rejected ${JSON.stringify(candidate)} (not a valid semver); using ${DEV_VERSION}\n`,
    );
  }
  process.stdout.write(`${version}\n`);
}
