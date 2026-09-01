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

  it("exposes job outputs for downstream workflow_run consumers (BSOD-357, BSOD-463)", () => {
    // BSOD-357: release-please creates the GitHub Release via the
    // workflow's `secrets.GITHUB_TOKEN`, which GitHub Actions refuses
    // to surface as a `release: published` event to other workflows.
    // The downstream `docker-release.yml` therefore listens on
    // `workflow_run: types: [completed]` and reads these job outputs.
    // Removing any of them breaks the trigger handoff silently — the
    // workflow file will still parse and run, but the docker image
    // will never be published. Regression guard.
    //
    // BSOD-463: as of googleapis/release-please-action@v5.0.0
    // (45996ed1f...) the action does NOT declare its outputs in
    // `action.yml`, so `steps.release.outputs.releases_created` /
    // `tag_name` / `sha` are empty even when release-please did
    // create a release. The job outputs below therefore reference
    // the dedicated "Resolve release info" step (`steps.resolve`),
    // which queries the GitHub Releases API to re-derive the same
    // values and writes them to `$GITHUB_OUTPUT` as proper step
    // outputs. Reverting any of these to `steps.release.outputs.*`
    // would silently break the docker-image publish path again.
    expect(source).toMatch(/^\s{4}outputs:\s*$/m);
    expect(source).toMatch(
      /^\s{6}releases_created:\s*\$\{\{\s*steps\.resolve\.outputs\.releases_created\s*\}\}\s*$/m,
    );
    expect(source).toMatch(
      /^\s{6}tag_name:\s*\$\{\{\s*steps\.resolve\.outputs\.tag_name\s*\}\}\s*$/m,
    );
    expect(source).toMatch(
      /^\s{6}sha:\s*\$\{\{\s*steps\.resolve\.outputs\.sha\s*\}\}\s*$/m,
    );
    expect(source).toMatch(
      /^\s{6}prerelease:\s*\$\{\{\s*steps\.resolve\.outputs\.prerelease\s*\}\}\s*$/m,
    );
  });

  it("re-derives release info from the GitHub Releases API (BSOD-463 workaround)", () => {
    // The release-please action's `core.setOutput('releases_created',
    // ...)` etc. calls are silently dropped because its `action.yml`
    // doesn't list those output names. We re-derive the same values
    // by querying the GitHub Releases API, then write them to
    // `$GITHUB_OUTPUT` from a dedicated step so the job-level
    // `outputs:` above (and therefore `github.event.workflow_run.outputs.*`
    // in downstream consumers) carry real values.
    expect(source).toMatch(
      /^\s{6}-\s+name:\s*Resolve release info for downstream workflow_run consumers\s*$/m,
    );
    expect(source).toMatch(/^\s{8}id:\s*resolve\s*$/m);
    // Must consult the GitHub Releases API for the canonical sha and
    // prerelease flag — the action's setOutput calls are unreliable.
    expect(source).toMatch(
      /gh api "repos\/\$\{\{\s*github\.repository\s*\}\}\/releases/,
    );
    // Must thread untrusted upstream outputs through `env:` (never
    // interpolated into `run:`) per the script-injection convention
    // used in `docker-release.yml`.
    expect(source).toMatch(
      /ACTION_RELEASES_CREATED:\s*\$\{\{\s*steps\.release\.outputs\.releases_created\s*\}\}/,
    );
    expect(source).toMatch(
      /ACTION_TAG_NAME:\s*\$\{\{\s*steps\.release\.outputs\.tag_name\s*\}\}/,
    );
    // Must write the resolved values to $GITHUB_OUTPUT so they
    // propagate to `github.event.workflow_run.outputs.*`.
    expect(source).toMatch(/>>\s*"\$GITHUB_OUTPUT"/);
    // Must distinguish "release created" from "no release" — when
    // release-please completes without a release (no conventional
    // commits since the last tag), the downstream guard must skip
    // the run cleanly.
    expect(source).toMatch(/releases_created=true/);
    expect(source).toMatch(/releases_created=false/);
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
