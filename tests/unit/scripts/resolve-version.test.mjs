import { describe, expect, it } from "vitest";
import { resolveVersion } from "../../../scripts/resolve-version.mjs";

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
