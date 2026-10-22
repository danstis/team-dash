import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const dockerignorePath = resolve(repoRoot, ".dockerignore");

const dockerignore = readFileSync(dockerignorePath, "utf8");

/**
 * The active deny-list: every non-blank, non-comment line of `.dockerignore`.
 * Comments explain the entries but never exclude anything themselves.
 */
function ignorePatterns(source: string): string[] {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

const patterns = ignorePatterns(dockerignore);

describe(".dockerignore (build-context deny-list)", () => {
  it("exists at the repository root and is non-empty", () => {
    expect(dockerignore.length).toBeGreaterThan(0);
  });

  describe("development-only assets", () => {
    it("excludes the dev/ directory that holds the MSW browser worker", () => {
      expect(patterns).toContain("dev");
    });

    it("no longer references the moved public/mockServiceWorker.js worker", () => {
      expect(dockerignore).not.toContain("public/mockServiceWorker.js");
    });

    it("has no deny-list entry for the MSW worker at all", () => {
      expect(
        patterns.filter((pattern) => pattern.includes("mockServiceWorker")),
      ).toEqual([]);
    });
  });

  describe("VCS history and local secrets", () => {
    it("excludes the .git directory so repository history never reaches the daemon", () => {
      expect(patterns).toContain(".git");
    });

    it("excludes .gitignore", () => {
      expect(patterns).toContain(".gitignore");
    });

    it("excludes .env", () => {
      expect(patterns).toContain(".env");
    });

    it("excludes every .env.* variant", () => {
      expect(patterns).toContain(".env.*");
    });

    it("excludes the .gitnexus analysis cache, a local-only artefact of the same class", () => {
      expect(patterns).toContain(".gitnexus");
    });
  });

  describe("the deny-list does not starve the image build", () => {
    it("keeps public/ out of the deny-list so the committed PWA icons are still copied", () => {
      expect(
        patterns.filter(
          (pattern) => pattern === "public" || pattern.startsWith("public/"),
        ),
      ).toEqual([]);
    });

    it("keeps src/ out of the deny-list so the application source is still copied", () => {
      expect(
        patterns.filter(
          (pattern) => pattern === "src" || pattern.startsWith("src/"),
        ),
      ).toEqual([]);
    });
  });
});
