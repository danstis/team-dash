#!/usr/bin/env node
import process from "node:process";

import { parseArgs } from "./parse-args.mjs";

// Re-export the shared `parseArgs` so the per-script test
// (`tests/unit/scripts/resolve-version.test.mjs`) can keep importing it
// from this module. The single source of truth lives in
// `scripts/lib/parse-args.mjs`.
export { parseArgs };

export function resolveVersion({ refType, refName, latestTag } = {}) {
  const stripV = (value) => (value ? value.replace(/^v/, "") : "");
  if (refType === "tag" && refName) {
    return stripV(refName);
  }
  if (latestTag) {
    return stripV(latestTag);
  }
  return "0.0.0-dev";
}

const isMain = import.meta.url === new URL(process.argv[1], "file://").href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const version = resolveVersion({
    refType: args["ref-type"] ?? "",
    refName: args["ref-name"] ?? "",
    latestTag: args["latest-tag"] ?? "",
  });
  process.stdout.write(`${version}\n`);
}
