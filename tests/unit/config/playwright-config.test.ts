import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import config from "../../../playwright.config";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

describe("Playwright configuration (T009)", () => {
  it("points the test directory at tests/e2e (plan.md Project Structure)", () => {
    expect(config.testDir).toBe("./tests/e2e");
  });

  it("resolves to an existing tests/e2e directory under the repo root", () => {
    const testDir = config.testDir ?? "";
    expect(typeof testDir).toBe("string");

    const resolved = resolve(repoRoot, testDir);
    expect(
      existsSync(resolved),
      `testDir "${testDir}" does not exist at ${resolved}`,
    ).toBe(true);
  });
});
