#!/usr/bin/env node
import process from "node:process";

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
  const args = Object.fromEntries(
    process.argv.slice(2).flatMap((arg) => {
      if (!arg.startsWith("--")) return [];
      const [, body] = arg.split(/^--/, 2);
      const eqIndex = body.indexOf("=");
      if (eqIndex === -1) return [[body, "true"]];
      return [[body.slice(0, eqIndex), body.slice(eqIndex + 1)]];
    }),
  );
  const version = resolveVersion({
    refType: args["ref-type"] ?? "",
    refName: args["ref-name"] ?? "",
    latestTag: args["latest-tag"] ?? "",
  });
  process.stdout.write(`${version}\n`);
}
