import { execFileSync, spawnSync } from "node:child_process";
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

  // BSOD-631 — the resolved value is written to `$GITHUB_OUTPUT` and then
  // interpolated into the Sonar scanner arguments, so it must be a plain
  // semver string. A ref name is attacker-influencable text (git allows
  // `$`, backticks, `"`, `;`, `|`, `&`, `(`, `)` in ref names), so it
  // cannot be trusted to be a version.
  it("accepts a legitimate tag ref name", () => {
    expect(
      resolveVersion({
        refType: "tag",
        refName: "v1.4.2",
        latestTag: "v0.1.0",
      }),
    ).toBe("1.4.2");
  });

  it("rejects a tag ref name that is not a valid semver", () => {
    expect(
      resolveVersion({
        refType: "tag",
        refName: 'v1.0.0"; id; echo "',
      }),
    ).toBe("0.0.0-dev");
  });

  it("rejects a tag ref name that carries a command substitution", () => {
    expect(
      resolveVersion({
        refType: "tag",
        refName: "v1.0.0$(id)",
      }),
    ).toBe("0.0.0-dev");
  });

  it("rejects a tag ref name that carries a newline", () => {
    expect(
      resolveVersion({
        refType: "tag",
        refName: "v1.0.0\nsecond=line",
      }),
    ).toBe("0.0.0-dev");
  });

  it("rejects a latest tag that is not a valid semver", () => {
    expect(
      resolveVersion({
        refType: "branch",
        refName: "main",
        latestTag: "not-a-version",
      }),
    ).toBe("0.0.0-dev");
  });

  it("keeps a pre-release version", () => {
    expect(
      resolveVersion({
        refType: "tag",
        refName: "v1.0.0-rc.1",
      }),
    ).toBe("1.0.0-rc.1");
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

  it("prints the fallback version and explains the rejection on stderr", () => {
    const result = spawnSync(
      process.execPath,
      [scriptPath, "--ref-type=tag", '--ref-name=v1.0.0"; id; echo "'],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("0.0.0-dev\n");
    expect(result.stderr).toContain("not a valid semver");
    // The reason must stay on a single line — a rejected candidate could
    // otherwise forge extra log lines (or step outputs).
    expect(result.stderr.trimEnd().split("\n")).toHaveLength(1);
  });
});
