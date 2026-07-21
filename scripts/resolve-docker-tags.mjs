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
  const isPrerelease = prerelease === true;
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

function coerceBool(value) {
  if (value === true) return true;
  if (typeof value === "string") {
    const lowered = value.toLowerCase();
    if (lowered === "true" || lowered === "1" || lowered === "yes") return true;
    return false;
  }
  return Boolean(value);
}

const isMain = import.meta.url === new URL(process.argv[1], "file://").href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const result = resolveDockerTags({
    tagName: args["tag-name"] ?? "",
    prerelease: coerceBool(args["prerelease"]),
    onMain: coerceBool(args["on-main"]),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
