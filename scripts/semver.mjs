#!/usr/bin/env node
/**
 * Shared semver validation for the repo's Node ESM scripts
 * (`scripts/*.mjs`).
 *
 * `scripts/resolve-docker-tags.mjs` carried a strict `SEMVER_RE` for the
 * release-please tag it publishes to Docker, and `scripts/resolve-version.mjs`
 * resolved a version for the Sonar scan without validating it at all. Both
 * values end up written to `$GITHUB_OUTPUT` and interpolated into CI command
 * lines, so they must be plain semver strings. One pattern, one home —
 * sibling to `scripts/parse-args.mjs` (which did the same job for the shared
 * CLI argument parser).
 *
 * The pattern is the official SemVer 2.0.0 grammar:
 * `major.minor.patch[-prerelease][+build]`, with no leading `v` and no
 * leading zeroes in the numeric identifiers.
 *
 * @example
 *   isSemver("1.4.2"); // => true
 *   isSemver("v1.4.2"); // => false (the `v` prefix is stripped by callers)
 *   isSemver('1.4.2"; id; echo "'); // => false
 */

/**
 * Strict SemVer 2.0.0 pattern.
 *
 * The capture groups are relied on by `scripts/resolve-docker-tags.mjs`
 * (`match[1]` = major, `match[2]` = minor, `match[4]` = prerelease), so the
 * group layout must not change without updating that script.
 */
export const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * Is `value` a plain semver string?
 *
 * @param {unknown} value
 *   Candidate version string. Non-strings are rejected.
 * @returns {boolean}
 *   `true` when `value` matches {@link SEMVER_RE}.
 */
export function isSemver(value) {
  return typeof value === "string" && SEMVER_RE.test(value);
}
