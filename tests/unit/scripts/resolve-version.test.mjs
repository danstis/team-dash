import { execFileSync } from "node:child_process";
import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseArgs,
  resolveVersion,
} from "../../../scripts/resolve-version.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(testDir, "../../../scripts/resolve-version.mjs");

describe("resolveVersion", () => {
  it("strips the v prefix from a tag ref", () => {
    expect(
      resolveVersion({
        refType: "tag",
        refName: "v0.1.0",
        latestTag: "v0.1.0",
      }),
    ).toBe("0.1.0");
  });

  it("returns the tag name unchanged when it has no v prefix", () => {
    expect(
      resolveVersion({
        refType: "tag",
        refName: "0.1.0",
        latestTag: "0.1.0",
      }),
    ).toBe("0.1.0");
  });

  it("prefers the tag ref name over the latest tag on tag builds", () => {
    expect(
      resolveVersion({
        refType: "tag",
        refName: "v0.2.1",
        latestTag: "v0.1.0",
      }),
    ).toBe("0.2.1");
  });

  it("uses the latest tag for branch refs when one exists", () => {
    expect(
      resolveVersion({
        refType: "branch",
        refName: "main",
        latestTag: "v0.1.0",
      }),
    ).toBe("0.1.0");
  });

  it("falls back to 0.0.0-dev when no tag is reachable", () => {
    expect(
      resolveVersion({
        refType: "branch",
        refName: "main",
        latestTag: "",
      }),
    ).toBe("0.0.0-dev");
  });

  it("falls back to 0.0.0-dev when arguments are missing", () => {
    expect(resolveVersion({})).toBe("0.0.0-dev");
  });

  it("strips the v prefix from the latest tag", () => {
    expect(
      resolveVersion({
        refType: "branch",
        refName: "feat/some-feature",
        latestTag: "v1.4.7",
      }),
    ).toBe("1.4.7");
  });
});

describe("parseArgs", () => {
  it("parses --key=value pairs and boolean flags", () => {
    expect(
      parseArgs(["--ref-type=tag", "--ref-name=v1.2.3", "--verbose", "main"]),
    ).toEqual({
      "ref-name": "v1.2.3",
      "ref-type": "tag",
      verbose: "true",
    });
  });
});

describe("resolve-version CLI", () => {
  it("prints the resolved version from CLI arguments", () => {
    const output = execFileSync(
      process.execPath,
      [
        scriptPath,
        "--ref-type=tag",
        "--ref-name=v2.3.4",
        "--latest-tag=v1.0.0",
      ],
      { encoding: "utf8" },
    );
    expect(output).toBe("2.3.4\n");
  });
});
