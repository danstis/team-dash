#!/usr/bin/env node
/**
 * Shared semver validation for the repo's Node ESM scripts
 * (`scripts/*.mjs`).
 *
 * `scripts/resolve-docker-tags.mjs` needs the release tag it publishes to
 * Docker to be a plain semver string, and `scripts/resolve-version.mjs`
 * needs the version it hands to the Sonar scan to be one too — both end up
 * written to `$GITHUB_OUTPUT` and interpolated into CI command lines. One
 * implementation, one home — sibling to `scripts/parse-args.mjs` (which did
 * the same job for the shared CLI argument parser).
 *
 * The validation is a small parser rather than one regular expression. The
 * canonical SemVer 2.0.0 pattern has a regex complexity of 59 while
 * Sonar's `javascript:S5843` allows 20, and `scripts/**` is analysed by
 * Sonar since BSOD-749. The parser below accepts and rejects exactly the
 * same versions as that pattern while staying readable.
 *
 * The accepted grammar is SemVer 2.0.0: `major.minor.patch`, optionally
 * followed by a `-` pre-release section and a `+` build section. Numeric
 * identifiers carry no leading zero; pre-release identifiers are
 * alphanumeric (digits, letters, hyphens) and build identifiers may also
 * carry leading zeros. A version never carries a line terminator, which
 * would otherwise reach `$GITHUB_OUTPUT` and forge an extra line there.
 *
 * @example
 *   parseSemver("1.4.2"); // => { major: "1", minor: "4", patch: "2", ... }
 *   parseSemver("v1.4.2"); // => null (the `v` prefix is stripped by callers)
 *   parseSemver('1.4.2"; id; echo "'); // => null
 */

// A numeric identifier: `0`, or a digit string without a leading zero.
const NUMERIC_RE = /^(?:0|[1-9]\d*)$/;

// An alphanumeric identifier: digits, letters and hyphens.
const IDENTIFIER_RE = /^[0-9A-Za-z-]+$/;

// A purely numeric identifier, used to apply the leading-zero rule.
const DIGITS_RE = /^\d+$/;

const DOT = ".";
const HYPHEN = "-";
const PLUS = "+";

/**
 * Is `value` a numeric identifier (no leading zero)?
 *
 * @param {string} value
 * @returns {boolean}
 */
function isNumericIdentifier(value) {
  return NUMERIC_RE.test(value);
}

/**
 * Is `value` a build identifier (alphanumeric, leading zeros allowed)?
 *
 * @param {string} value
 * @returns {boolean}
 */
function isBuildIdentifier(value) {
  return IDENTIFIER_RE.test(value);
}

/**
 * Is `value` a pre-release identifier (alphanumeric, no leading zero when
 * it is numeric)?
 *
 * @param {string} value
 * @returns {boolean}
 */
function isPrereleaseIdentifier(value) {
  if (!IDENTIFIER_RE.test(value)) return false;
  if (!DIGITS_RE.test(value)) return true;
  return NUMERIC_RE.test(value);
}

/**
 * Split a version into its core, pre-release and build sections.
 *
 * @param {string} value
 * @returns {{core: string, prerelease: string|undefined, build: string|undefined}}
 */
function splitVersion(value) {
  const plusIndex = value.indexOf(PLUS);
  const build = plusIndex === -1 ? undefined : value.slice(plusIndex + 1);
  const head = plusIndex === -1 ? value : value.slice(0, plusIndex);
  const hyphenIndex = head.indexOf(HYPHEN);
  const prerelease =
    hyphenIndex === -1 ? undefined : head.slice(hyphenIndex + 1);
  const core = hyphenIndex === -1 ? head : head.slice(0, hyphenIndex);
  return { core, prerelease, build };
}

/**
 * Parse a semver string into its parts.
 *
 * @param {unknown} value
 *   Candidate version string. Non-strings are rejected.
 * @returns {{major: string, minor: string, patch: string, prerelease: string|undefined, build: string|undefined}|null}
 *   The parsed parts, or `null` when `value` is not a valid semver string.
 */
export function parseSemver(value) {
  if (typeof value !== "string" || value === "") return null;
  const { core, prerelease, build } = splitVersion(value);
  const parts = core.split(DOT);
  if (parts.length !== 3) return null;
  const [major, minor, patch] = parts;
  if (
    !isNumericIdentifier(major) ||
    !isNumericIdentifier(minor) ||
    !isNumericIdentifier(patch)
  ) {
    return null;
  }
  if (prerelease !== undefined && !isPrereleaseSection(prerelease)) {
    return null;
  }
  if (build !== undefined && !isBuildSection(build)) return null;
  return { major, minor, patch, prerelease, build };
}

/**
 * Is every identifier of a pre-release section valid?
 *
 * @param {string} value
 * @returns {boolean}
 */
function isPrereleaseSection(value) {
  return value.split(DOT).every(isPrereleaseIdentifier);
}

/**
 * Is every identifier of a build section valid?
 *
 * @param {string} value
 * @returns {boolean}
 */
function isBuildSection(value) {
  return value.split(DOT).every(isBuildIdentifier);
}

/**
 * Is `value` a plain semver string?
 *
 * @param {unknown} value
 *   Candidate version string. Non-strings are rejected.
 * @returns {boolean}
 *   `true` when `value` parses as semver.
 */
export function isSemver(value) {
  return parseSemver(value) !== null;
}
