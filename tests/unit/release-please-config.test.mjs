import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function loadJson(relativePath) {
  const raw = await readFile(resolve(repoRoot, relativePath), "utf8");
  return JSON.parse(raw);
}

describe("release-please config", () => {
  it("uses the simple release type and pins the team-dash package name", async () => {
    const config = await loadJson("release-please-config.json");
    expect(config["release-type"]).toBe("simple");
    expect(config["package-name"]).toBe("team-dash");
  });

  it("keeps versions under 1.0.0 by forcing minor and patch bumps in 0.x", async () => {
    const config = await loadJson("release-please-config.json");
    expect(config["bump-minor-pre-major"]).toBe(true);
    expect(config["bump-patch-for-minor-pre-major"]).toBe(true);
  });

  it("produces a single semver tag without a component prefix", async () => {
    const config = await loadJson("release-please-config.json");
    expect(config["include-component-in-tag"]).toBe(false);
  });

  it("writes the changelog to CHANGELOG.md", async () => {
    const config = await loadJson("release-please-config.json");
    expect(config["changelog-path"]).toBe("CHANGELOG.md");
  });

  it("uses conventional commit sections for the changelog", async () => {
    const config = await loadJson("release-please-config.json");
    const sections = config["changelog-sections"] ?? [];
    const visible = sections.filter((section) => section.hidden !== true);
    const types = visible.map((section) => section.type);
    expect(types).toContain("feat");
    expect(types).toContain("fix");
    expect(types).toContain("perf");
    expect(types).toContain("revert");
  });
});

describe("release-please manifest bootstrap", () => {
  it("starts at 0.1.0 for the team-dash package", async () => {
    const manifest = await loadJson(".release-please-manifest.json");
    expect(manifest).toEqual({ ".": "0.1.0" });
  });

  it("uses a semver-valid 0.1.0 baseline that stays under 1.0.0", async () => {
    const manifest = await loadJson(".release-please-manifest.json");
    const version = manifest["."];
    expect(version).toMatch(/^0\.\d+\.\d+$/);
    const [major] = version.split(".").map(Number);
    expect(major).toBe(0);
  });
});
