import { describe, expect, it } from "vitest";
import { isSemver, SEMVER_RE } from "../../../scripts/semver.mjs";

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
  });

  it("rejects non-string values", () => {
    expect(isSemver(undefined)).toBe(false);
    expect(isSemver(null)).toBe(false);
    expect(isSemver(1)).toBe(false);
  });
});

describe("SEMVER_RE", () => {
  it("is the shared pattern both resolvers validate against", () => {
    expect(SEMVER_RE.test("0.1.0")).toBe(true);
    expect(SEMVER_RE.test("not-a-version")).toBe(false);
  });
});
