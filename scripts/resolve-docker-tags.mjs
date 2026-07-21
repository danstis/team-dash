#!/usr/bin/env node
//
// Resolve the list of Docker image tags to publish from a release-please
// GitHub Release. The output is consumed by `.github/workflows/docker-release.yml`
// to drive `docker/build-push-action`.
//
// Tag priority:
//   1. The full release-please tag (e.g. `0.1.0`, `1.0.0-rc.1`).
//   2. The major-minor prefix (e.g. `0.1`, `1.0`) for consumers who want
//      auto-update within a minor line.
//   3. `latest` only when the release is stable (non-prerelease) AND was
//      cut from the `main` branch — never for pre-releases or
//      back-ports.
//
// `prerelease` resolution rules (BSOD-258 follow-up):
//   - When the caller passes an explicit boolean `prerelease`, that wins
//     (covers the GitHub release event's `release.prerelease` flag,
//     which can disagree with the semver for hand-flagged releases).
//   - When `prerelease` is omitted (undefined / null / empty string),
//     it is derived from the tag's semver: the tag is a pre-release iff
//     it has a `-` segment (e.g. `1.0.0-rc.1`). This is the default
//     for the `workflow_dispatch` re-publish path, where the tag's
//     semver is the source of truth and we cannot trust the caller to
//     remember to set a separate flag.
//
// CLI usage:
//   node scripts/resolve-docker-tags.mjs \
//     --tag-name=v0.1.0 --prerelease=false --on-main=true
//
//   # emits one JSON object on stdout:
//   # {"version":"0.1.0","majorMinor":"0.1","prerelease":false,"onMain":true,"tags":["0.1.0","0.1","latest"]}

import process from "node:process";

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function parseArgs(argv = []) {
  return Object.fromEntries(
    argv.flatMap((arg) => {
      if (!arg.startsWith("--")) return [];
      const [, body] = arg.split(/^--/, 2);
      const eqIndex = body.indexOf("=");
      if (eqIndex === -1) return [[body, "true"]];
      return [[body.slice(0, eqIndex), body.slice(eqIndex + 1)]];
    }),
  );
}

// Coerce a CLI string into a boolean. Returns `undefined` for values
// that should be treated as "not provided" so the caller can fall back
// to a default (e.g. semver-derived prerelease).
function coerceBool(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value === "") return undefined;
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === "string") {
    const lowered = value.toLowerCase();
    if (lowered === "true" || lowered === "1" || lowered === "yes") return true;
    if (lowered === "false" || lowered === "0" || lowered === "no")
      return false;
  }
  return undefined;
}

export function resolveDockerTags({ tagName, prerelease, onMain } = {}) {
  if (typeof tagName !== "string" || tagName.trim() === "") {
    throw new Error("tagName is required");
  }
  const stripped = tagName.startsWith("v") ? tagName.slice(1) : tagName;
  const match = SEMVER_RE.exec(stripped);
  if (!match) {
    throw new Error(`tagName '${tagName}' is not a valid semver string`);
  }
  const version = stripped;
  const majorMinor = `${match[1]}.${match[2]}`;

  // `prerelease`: explicit boolean wins; otherwise derive from the
  // semver's `-` segment (group 4 of the regex).
  let isPrerelease;
  if (prerelease === true || prerelease === false) {
    isPrerelease = prerelease;
  } else {
    isPrerelease = match[4] !== undefined;
  }

  const isOnMain = onMain === true;
  const tags = [version, majorMinor];
  if (!isPrerelease && isOnMain) {
    tags.push("latest");
  }
  return {
    version,
    majorMinor,
    prerelease: isPrerelease,
    onMain: isOnMain,
    tags,
  };
}

const isMain = import.meta.url === new URL(process.argv[1], "file://").href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const result = resolveDockerTags({
    tagName: args["tag-name"] ?? "",
    prerelease: coerceBool(args["prerelease"]),
    onMain: coerceBool(args["on-main"]) ?? false,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
