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

  it("no longer declares job outputs for downstream workflow_run consumers (BSOD-775)", () => {
    // BSOD-357 made release-please's release reachable to the
    // downstream `docker-release.yml` through job outputs. BSOD-466
    // established that the `workflow_run` webhook payload carries NO
    // `outputs` field at all (see the workflow-run schema published by
    // octokit/webhooks: `conclusion`, `name`, `head_branch`,
    // `head_repository`, `head_sha`, ... but no `outputs`), so those
    // job outputs could never be read by any consumer — BSOD-775
    // removes the dead plumbing instead of leaving it declared and
    // unread.
    //
    // The downstream workflow now resolves the release itself, from the
    // GitHub Releases API, matched on the upstream run's commit.
    expect(source).not.toMatch(/^\s{4}outputs:\s*$/m);
    expect(source).not.toMatch(/steps\.resolve\.outputs\./);
    expect(source).not.toMatch(/releases_created/);
  });

  it("no longer runs the 'Resolve release info' step (BSOD-775)", () => {
    // The step re-derived `releases_created` / `tag_name` / `sha` /
    // `prerelease` from the GitHub Releases API for a consumer that
    // does not exist any more. With the job outputs gone, the step is
    // dead weight: it costs one API call on every release-please run
    // and its results are read by nobody.
    expect(source).not.toMatch(/Resolve release info/);
    expect(source).not.toMatch(/^\s{8}id:\s*resolve\s*$/m);
    expect(source).not.toMatch(/gh api/);
  });

  it("still runs the SHA-pinned release-please action against main (BSOD-775)", () => {
    // Removing the dead plumbing must not touch the release-please
    // action itself (nor its pinned version).
    expect(source).toMatch(/^\s{6}- id: release\s*$/m);
    expect(source).toMatch(
      /uses:\s*googleapis\/release-please-action@[a-f0-9]{40} # v\d+\.\d+\.\d+/,
    );
    expect(source).toMatch(/config-file:\s*release-please-config\.json/);
    expect(source).toMatch(/manifest-file:\s*\.release-please-manifest\.json/);
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
