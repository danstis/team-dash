import { execFileSync } from "node:child_process";
import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseArgs,
  resolveDockerTags,
} from "../../../scripts/resolve-docker-tags.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(testDir, "../../../scripts/resolve-docker-tags.mjs");

describe("resolveDockerTags", () => {
  it("strips the v prefix from the tag name", () => {
    expect(
      resolveDockerTags({
        tagName: "v0.1.0",
        prerelease: false,
        onMain: true,
      }),
    ).toEqual({
      version: "0.1.0",
      majorMinor: "0.1",
      prerelease: false,
      onMain: true,
      tags: ["0.1.0", "0.1", "latest"],
    });
  });

  it("accepts a tag name without the v prefix", () => {
    expect(
      resolveDockerTags({
        tagName: "0.2.1",
        prerelease: false,
        onMain: true,
      }),
    ).toEqual({
      version: "0.2.1",
      majorMinor: "0.2",
      prerelease: false,
      onMain: true,
      tags: ["0.2.1", "0.2", "latest"],
    });
  });

  it("emits [version, major.minor] and omits `latest` for pre-releases", () => {
    expect(
      resolveDockerTags({
        tagName: "v1.0.0-rc.1",
        prerelease: true,
        onMain: true,
      }),
    ).toEqual({
      version: "1.0.0-rc.1",
      majorMinor: "1.0",
      prerelease: true,
      onMain: true,
      tags: ["1.0.0-rc.1", "1.0"],
    });
  });

  it("omits `latest` when the release is not on main even if stable", () => {
    expect(
      resolveDockerTags({
        tagName: "v0.3.0",
        prerelease: false,
        onMain: false,
      }),
    ).toEqual({
      version: "0.3.0",
      majorMinor: "0.3",
      prerelease: false,
      onMain: false,
      tags: ["0.3.0", "0.3"],
    });
  });

  it("includes `latest` only when stable AND on main", () => {
    expect(
      resolveDockerTags({
        tagName: "v0.3.0",
        prerelease: false,
        onMain: true,
      }).tags,
    ).toContain("latest");

    expect(
      resolveDockerTags({
        tagName: "v0.3.0",
        prerelease: true,
        onMain: true,
      }).tags,
    ).not.toContain("latest");

    expect(
      resolveDockerTags({
        tagName: "v0.3.0",
        prerelease: false,
        onMain: false,
      }).tags,
    ).not.toContain("latest");
  });

  it("puts version before major.minor before latest in the tags array", () => {
    const { tags } = resolveDockerTags({
      tagName: "v2.5.7",
      prerelease: false,
      onMain: true,
    });
    expect(tags).toEqual(["2.5.7", "2.5", "latest"]);
  });

  it("handles major-only versions (X.0.0)", () => {
    expect(
      resolveDockerTags({
        tagName: "v1.0.0",
        prerelease: false,
        onMain: true,
      }),
    ).toEqual({
      version: "1.0.0",
      majorMinor: "1.0",
      prerelease: false,
      onMain: true,
      tags: ["1.0.0", "1.0", "latest"],
    });
  });

  it("throws on an empty tagName", () => {
    expect(() =>
      resolveDockerTags({ tagName: "", prerelease: false, onMain: true }),
    ).toThrow(/tagName/i);
    expect(() =>
      resolveDockerTags({ prerelease: false, onMain: true }),
    ).toThrow(/tagName/i);
  });

  it("throws on a non-semver tagName", () => {
    expect(() =>
      resolveDockerTags({
        tagName: "not-a-version",
        prerelease: false,
        onMain: true,
      }),
    ).toThrow(/semver/i);
    expect(() =>
      resolveDockerTags({
        tagName: "v1.2",
        prerelease: false,
        onMain: true,
      }),
    ).toThrow(/semver/i);
  });

  it("treats prerelease/onMain only as true when strictly the boolean `true`", () => {
    expect(
      resolveDockerTags({
        tagName: "v0.1.0",
        prerelease: "false",
        onMain: "true",
      }).tags,
    ).not.toContain("latest");

    expect(
      resolveDockerTags({
        tagName: "v0.1.0",
        prerelease: "false",
        onMain: 1,
      }).tags,
    ).not.toContain("latest");
  });
});

describe("parseArgs (resolve-docker-tags)", () => {
  it("parses --key=value pairs and boolean flags", () => {
    expect(
      parseArgs(["--tag-name=v0.1.0", "--prerelease=false", "--on-main=true"]),
    ).toEqual({
      "tag-name": "v0.1.0",
      prerelease: "false",
      "on-main": "true",
    });
  });
});

describe("resolve-docker-tags CLI", () => {
  it("prints JSON with version, majorMinor, prerelease, onMain, and tags", () => {
    const output = execFileSync(
      process.execPath,
      [scriptPath, "--tag-name=v0.1.0", "--prerelease=false", "--on-main=true"],
      { encoding: "utf8" },
    );
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({
      version: "0.1.0",
      majorMinor: "0.1",
      prerelease: false,
      onMain: true,
      tags: ["0.1.0", "0.1", "latest"],
    });
  });

  it("omits `latest` from the JSON when prerelease is true", () => {
    const output = execFileSync(
      process.execPath,
      [
        scriptPath,
        "--tag-name=v1.0.0-rc.1",
        "--prerelease=true",
        "--on-main=true",
      ],
      { encoding: "utf8" },
    );
    const parsed = JSON.parse(output);
    expect(parsed.tags).toEqual(["1.0.0-rc.1", "1.0"]);
    expect(parsed.prerelease).toBe(true);
  });

  it("exits non-zero on a non-semver tag", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [
          scriptPath,
          "--tag-name=not-a-version",
          "--prerelease=false",
          "--on-main=true",
        ],
        { encoding: "utf8", stdio: "pipe" },
      ),
    ).toThrow();
  });
});
