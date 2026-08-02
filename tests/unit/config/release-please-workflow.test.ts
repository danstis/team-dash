import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const workflowPath = resolve(repoRoot, ".github/workflows/release-please.yml");

const source = readFileSync(workflowPath, "utf8");

describe(".github/workflows/release-please.yml (BSOD-357)", () => {
  it("is a non-empty file under .github/workflows/", () => {
    expect(source.length).toBeGreaterThan(0);
    expect(existsSync(workflowPath)).toBe(true);
  });

  it("declares the workflow name", () => {
    expect(source).toMatch(/^name:\s*Release Please\s*$/m);
  });

  it("triggers on push to main and on workflow_dispatch", () => {
    expect(source).toMatch(/^\s{2}push:\s*$/m);
    expect(source).toMatch(/^\s{4}branches:\s*$/m);
    expect(source).toMatch(/^\s{6}-\s*main\s*$/m);
    expect(source).toMatch(/^\s{2}workflow_dispatch:\s*$/m);
  });

  it("requests contents/issues/pull-requests write permissions", () => {
    expect(source).toMatch(/^\s{2}contents:\s*write\s*$/m);
    expect(source).toMatch(/^\s{2}issues:\s*write\s*$/m);
    expect(source).toMatch(/^\s{2}pull-requests:\s*write\s*$/m);
  });

  it("uses the SHA-pinned googleapis/release-please-action@v5", () => {
    expect(source).toMatch(
      /googleapis\/release-please-action@[a-f0-9]{40} # v\d+\.\d+\.\d+/,
    );
  });

  it("exposes job outputs for downstream workflow_run consumers (BSOD-357)", () => {
    // BSOD-357: release-please creates the GitHub Release via the
    // workflow's `secrets.GITHUB_TOKEN`, which GitHub Actions refuses
    // to surface as a `release: published` event to other workflows.
    // The downstream `docker-release.yml` therefore listens on
    // `workflow_run: types: [completed]` and reads these job outputs.
    // Removing any of them breaks the trigger handoff silently — the
    // workflow file will still parse and run, but the docker image
    // will never be published. Regression guard.
    expect(source).toMatch(/^\s{4}outputs:\s*$/m);
    expect(source).toMatch(
      /^\s{6}releases_created:\s*\$\{\{\s*steps\.release\.outputs\.releases_created\s*\}\}\s*$/m,
    );
    expect(source).toMatch(
      /^\s{6}tag_name:\s*\$\{\{\s*steps\.release\.outputs\.tag_name\s*\}\}\s*$/m,
    );
    expect(source).toMatch(
      /^\s{6}sha:\s*\$\{\{\s*steps\.release\.outputs\.sha\s*\}\}\s*$/m,
    );
  });

  it("does not request `packages: write` (BSOD-258 intentionally stays out of ghcr.io)", () => {
    // The release-please workflow's job must NOT be granted
    // packages: write. Only docker-release.yml (which is the workflow
    // that actually pushes to ghcr.io) should hold that scope. A
    // regression here would expand the credential surface of every
    // release-please run for no benefit.
    expect(source).not.toMatch(/^\s{2}packages:\s*write\s*$/m);
  });
});
