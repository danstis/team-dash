import { describe, expect, it } from "vitest";
import { isSemver, parseSemver } from "../../../scripts/semver.mjs";

describe("parseSemver", () => {
  it("parses a release version", () => {
    expect(parseSemver("1.4.2")).toEqual({
      major: "1",
      minor: "4",
      patch: "2",
      prerelease: undefined,
      build: undefined,
    });
  });

  it("parses a pre-release version", () => {
    expect(parseSemver("1.0.0-rc.1")).toEqual({
      major: "1",
      minor: "0",
      patch: "0",
      prerelease: "rc.1",
      build: undefined,
    });
  });

  it("parses build metadata", () => {
    expect(parseSemver("1.0.0+build.5")).toEqual({
      major: "1",
      minor: "0",
      patch: "0",
      prerelease: undefined,
      build: "build.5",
    });
  });

  it("parses a pre-release with build metadata", () => {
    expect(parseSemver("1.0.0-rc.1+build.5")).toEqual({
      major: "1",
      minor: "0",
      patch: "0",
      prerelease: "rc.1",
      build: "build.5",
    });
  });

  it("rejects a version with a v prefix", () => {
    expect(parseSemver("v1.0.0")).toBeNull();
  });

  it("rejects a version that is missing a part", () => {
    expect(parseSemver("1.0")).toBeNull();
    expect(parseSemver("1.0.0.0")).toBeNull();
  });

  it("rejects numeric parts with a leading zero", () => {
    expect(parseSemver("01.0.0")).toBeNull();
    expect(parseSemver("1.00.0")).toBeNull();
  });

  it("rejects a numeric pre-release identifier with a leading zero", () => {
    expect(parseSemver("1.0.0-01")).toBeNull();
    expect(parseSemver("1.0.0-rc.01")).toBeNull();
  });

  it("accepts a numeric pre-release identifier without a leading zero", () => {
    expect(parseSemver("1.0.0-0")).not.toBeNull();
    expect(parseSemver("1.0.0-10")).not.toBeNull();
  });

  it("rejects empty pre-release and build sections", () => {
    expect(parseSemver("1.0.0-")).toBeNull();
    expect(parseSemver("1.0.0+")).toBeNull();
  });

  it("rejects empty identifiers inside a pre-release or build section", () => {
    expect(parseSemver("1.0.0-alpha..1")).toBeNull();
    expect(parseSemver("1.0.0+build..5")).toBeNull();
  });

  it("rejects a version carrying a line terminator", () => {
    // A trailing newline would reach `$GITHUB_OUTPUT` and forge an extra
    // line there, so it must never count as a valid version.
    expect(parseSemver("1.0.0\n")).toBeNull();
    expect(parseSemver("1.0.0\nsecond=line")).toBeNull();
  });

  it("rejects an empty or non-string value", () => {
    expect(parseSemver("")).toBeNull();
    expect(parseSemver(undefined)).toBeNull();
    expect(parseSemver(null)).toBeNull();
    expect(parseSemver(1)).toBeNull();
  });
});

describe("isSemver", () => {
  it("accepts release versions", () => {
    expect(isSemver("0.1.0")).toBe(true);
    expect(isSemver("1.4.2")).toBe(true);
    expect(isSemver("10.20.30")).toBe(true);
  });

  it("accepts pre-release and build metadata versions", () => {
    expect(isSemver("1.0.0-rc.1")).toBe(true);
    expect(isSemver("1.0.0-alpha.1")).toBe(true);
    expect(isSemver("1.0.0+build.5")).toBe(true);
  });

  it("rejects values that are not semver", () => {
    expect(isSemver("")).toBe(false);
    expect(isSemver("v1.0.0")).toBe(false);
    expect(isSemver("1.0")).toBe(false);
    expect(isSemver("1.0.0.0")).toBe(false);
    expect(isSemver("not-a-version")).toBe(false);
  });

  it("rejects values that carry shell or output-file metacharacters", () => {
    expect(isSemver('1.0.0"; id; echo "')).toBe(false);
    expect(isSemver("1.0.0$(id)")).toBe(false);
    expect(isSemver("1.0.0`id`")).toBe(false);
    expect(isSemver("1.0.0\nsecond=line")).toBe(false);
    expect(isSemver("1.0.0\n")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isSemver(undefined)).toBe(false);
    expect(isSemver(null)).toBe(false);
    expect(isSemver(1)).toBe(false);
  });
});
