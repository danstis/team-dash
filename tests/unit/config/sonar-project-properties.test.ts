import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const sonarPropertiesPath = resolve(repoRoot, "sonar-project.properties");

const raw = readFileSync(sonarPropertiesPath, "utf8");

/**
 * Minimal reader for SonarCloud's `key=value` properties format.
 * Commented-out lines (`#sonar.projectName=...`) are inert
 * configuration and are therefore ignored.
 */
function readProperties(source: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("!")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    entries.set(
      trimmed.slice(0, separator).trim(),
      trimmed.slice(separator + 1).trim(),
    );
  }
  return entries;
}

const properties = readProperties(raw);

/** Comma-separated property value as a list of trimmed entries. */
function listValue(key: string): string[] {
  return (properties.get(key) ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

describe("sonar-project.properties (BSOD-749)", () => {
  it("is a non-empty file at the repository root", () => {
    expect(raw.length).toBeGreaterThan(0);
  });

  it("analyses the whole repository (`sonar.sources=.`) so scripts/ is in scope", () => {
    expect(properties.get("sonar.sources")).toBe(".");
  });

  it("does not exclude scripts/** from static analysis", () => {
    // BSOD-749: `sonar.exclusions` removes files from the analysis
    // itself (the rules engine), not just from coverage. The CI
    // helpers under `scripts/` run in credentialed jobs, so they must
    // be scanned.
    expect(listValue("sonar.exclusions")).not.toContain("scripts/**");
  });

  it("does not exclude any path under scripts/ from static analysis", () => {
    // Guards against a future edit re-hiding a single script (e.g.
    // `scripts/resolve-version.mjs`) behind a narrower pattern.
    const scriptExclusions = listValue("sonar.exclusions").filter((entry) =>
      entry.startsWith("scripts/"),
    );
    expect(scriptExclusions).toEqual([]);
  });

  it("still excludes scripts/** from coverage measurement", () => {
    // Coverage is the setting that legitimately excuses CI helpers:
    // they are not exercised by the Vitest suites.
    expect(listValue("sonar.coverage.exclusions")).toContain("scripts/**");
  });

  it("still excludes scripts/** from duplication detection", () => {
    expect(listValue("sonar.cpd.exclusions")).toContain("scripts/**");
  });

  it("keeps the test/dev-only exclusions that are still defensible", () => {
    expect(listValue("sonar.exclusions")).toEqual(
      expect.arrayContaining([
        "tests/**",
        "fixtures/**",
        "src/mocks/**",
        "dev/mockServiceWorker.js",
      ]),
    );
  });
});
