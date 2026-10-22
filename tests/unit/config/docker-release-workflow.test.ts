import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const workflowPath = resolve(repoRoot, ".github/workflows/docker-release.yml");
const scriptPath = resolve(repoRoot, "scripts/resolve-docker-tags.mjs");
const dockerfilePath = resolve(repoRoot, "docker/Dockerfile");

const source = readFileSync(workflowPath, "utf8");

function topLevelKeys(text: string): string[] {
  const keys: string[] = [];
  for (const line of text.split("\n")) {
    if (!line || line.startsWith(" ") || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    keys.push(line.slice(0, colon));
  }
  return keys;
}

type StepEnvBlock = { step: string; startLine: number; values: string[] };

// Collect the `env:` blocks that belong to a workflow *step* (i.e. the
// direct children of a `- name:` / `- uses:` list item), together with
// the values declared inside them.
//
// This matters for BSOD-776: a step-level `env:` block is materialised
// even when the step's own `if:` gate evaluates to false, so an
// expression that throws on an empty input fails the whole job from a
// step that never runs.
function collectStepEnvBlocks(text: string): StepEnvBlock[] {
  const lines = text.split("\n");
  const blocks: StepEnvBlock[] = [];
  let stepIndent: number | null = null;
  let stepName = "";

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";

    const stepItem = /^(\s*)-\s+(?:name|uses):\s*(.*?)\s*$/.exec(line);
    if (stepItem) {
      stepIndent = (stepItem[1] ?? "").length;
      stepName = stepItem[2] ?? "";
      continue;
    }

    const envHeader = /^(\s*)env:\s*$/.exec(line);
    if (!envHeader || stepIndent === null) continue;
    const envIndent = (envHeader[1] ?? "").length;
    // A step's direct children sit two spaces deeper than the step
    // item; anything else belongs to a nested mapping (`with:` etc.).
    if (envIndent !== stepIndent + 2) continue;

    const values: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const entry = lines[j] ?? "";
      if (entry.trim() === "") continue;
      const entryIndent = entry.length - entry.trimStart().length;
      if (entryIndent <= envIndent) break;
      // YAML comments inside the block are not env values.
      if (entry.trimStart().startsWith("#")) continue;
      values.push(entry.trim());
    }
    blocks.push({ step: stepName, startLine: i + 1, values });
  }

  return blocks;
}

describe(".github/workflows/docker-release.yml (BSOD-258)", () => {
  it("is a non-empty file under .github/workflows/", () => {
    expect(source.length).toBeGreaterThan(0);
    expect(existsSync(workflowPath)).toBe(true);
  });

  it("declares the workflow name", () => {
    expect(source).toMatch(/^name:\s*Docker Release\s*$/m);
  });

  it("triggers on `release.published`", () => {
    expect(source).toMatch(/^\s{2}release:\s*$/m);
    expect(source).toMatch(/^\s{4}types:\s*\[published\]\s*$/m);
  });

  it("also triggers on the `Release Please` workflow_run completion (BSOD-357)", () => {
    // BSOD-357: release-please (BSOD-257) creates the GitHub Release via
    // the workflow's `secrets.GITHUB_TOKEN`, which GitHub Actions
    // deliberately refuses to surface as a `release: published` event
    // to other workflows (anti-recursion policy). Without this second
    // trigger, every release-please release would silently skip the
    // Docker image publish step.
    expect(source).toMatch(/^\s{2}workflow_run:\s*$/m);
    expect(source).toMatch(
      /^\s{4}workflows:\s*\[\s*["']Release Please["']\s*\]\s*$/m,
    );
    expect(source).toMatch(/^\s{4}types:\s*\[completed\]\s*$/m);
  });

  it("guards the docker job on workflow_run fields that actually exist in the payload (BSOD-466)", () => {
    // BSOD-466: the old guard read
    // `github.event.workflow_run.outputs.releases_created`, but the
    // `workflow_run` webhook payload has NO `outputs` field at all (the
    // workflow-run schema published by octokit/webhooks lists
    // `conclusion`, `name`, `head_branch`, `head_repository`, `head_sha`,
    // ... but not `outputs`). The comparison was therefore always false
    // and every `workflow_run` run was skipped — no image was ever
    // published from a release.
    //
    // The guard now only uses payload fields that exist. The "upstream
    // created no release" case is handled further down (BSOD-775): the
    // release is resolved from the GitHub Releases API by matching the
    // upstream run's commit, and a run that created no release exits
    // green without publishing anything.
    expect(source).toMatch(/^\s{4}if:\s*\|?\s*$/m);
    expect(source).toMatch(
      /github\.event\.workflow_run\.conclusion == 'success'/,
    );
    expect(source).not.toMatch(/releases_created/);
  });

  it("refuses workflow_run events from forks or unrelated workflows (SonarCloud S7631)", () => {
    // `workflow_run` events fire for runs of the named workflow in
    // FORKS of this repository. The fork's run payload is
    // attacker-controllable (e.g. a crafted `tag_name` / `sha` output),
    // and although fork runs don't see our secrets, the docker job
    // holds `packages: write` and pushes to ghcr.io — so a malicious
    // fork could push arbitrary images to our namespace. Defend in
    // depth: restrict to the same repo + the exact workflow name.
    // BSOD-466: `github.repository` is a *string* ("owner/repo"), not an
    // object, so `github.repository.full_name` was always `null` and the
    // comparison could never be true — the guard was evaluated but could
    // never pass. The right-hand side must be `github.repository`.
    expect(source).toMatch(
      /github\.event\.workflow_run\.head_repository\.full_name == github\.repository(?![\w.])/,
    );
    expect(source).not.toMatch(/github\.repository\.full_name/);
    expect(source).toMatch(
      /github\.event\.workflow_run\.name == 'Release Please'/,
    );
  });

  it("is also re-runnable via workflow_dispatch with tag_name + source_branch inputs", () => {
    expect(source).toMatch(/^\s{2}workflow_dispatch:\s*$/m);
    expect(source).toMatch(/^\s{4}inputs:\s*$/m);
    expect(source).toMatch(/^\s{6}tag_name:\s*$/m);
    expect(source).toMatch(/^\s{8}required:\s*true\s*$/m);
    expect(source).toMatch(/^\s{6}source_branch:\s*$/m);
    expect(source).toMatch(/^\s{8}default:\s*['"]['"]\s*$/m);
  });

  it("threads workflow_run payload fields through env vars (no script-injection on upstream payload)", () => {
    // Same script-injection guard as for workflow_dispatch and
    // `release: published`: every token from the upstream workflow's
    // payload must reach `run:` via an env var, never by literal
    // `${{ github.event.workflow_run.* }}` interpolation.
    expect(source).toMatch(
      /WORKFLOW_RUN_HEAD_BRANCH:\s*\$\{\{\s*github\.event\.workflow_run\.head_branch\s*\}\}/,
    );
    // BSOD-466: the upstream run's `head_sha` — a field that DOES exist
    // on the workflow-run payload — is what the release is matched
    // against (BSOD-775).
    expect(source).toMatch(
      /WORKFLOW_RUN_HEAD_SHA:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}/,
    );
    // The commit that is checked out is the one the release was tagged
    // with, not the run head (BSOD-775).
    expect(source).toMatch(/echo "commit_sha=\$RELEASE_SHA"/);
  });

  it("resolves the workflow_run release from the GitHub Releases API, not from the payload (BSOD-466)", () => {
    // The payload carries no job outputs, so the release tag can only
    // come from the API — never from the (attacker-controllable) run
    // payload.
    expect(source).not.toMatch(/github\.event\.workflow_run\.outputs\./);
    expect(source).toMatch(/GH_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
    expect(source).toMatch(
      /gh api "repos\/\$GITHUB_REPOSITORY\/releases\?per_page=10"/,
    );
    expect(source).toMatch(/echo "tag_name=\$TAG_NAME"/);
    // `gh api` prints the error body on stdout for an HTTP error (a 401
    // body is not a release), so the resolved release is only trusted
    // when the API call itself succeeded.
    expect(source).toMatch(/\|\| RELEASES_JSON=""/);
  });

  it("matches the workflow_run release by the upstream run's commit, not by 'latest' (BSOD-775)", () => {
    // release-please creates the GitHub Release with `target_commitish`
    // set to the commit it tagged, so the release whose
    // `target_commitish` equals the upstream run's `head_sha` is
    // exactly the release this run produced.
    //
    // `releases/latest` (the newest stable release) is NOT good
    // enough: it is unrelated to the triggering run. It made a
    // Release Please run that created no release publish an older tag
    // (from the current `main` HEAD) whenever that tag's image had
    // never been published.
    expect(source).not.toMatch(/releases\/latest/);
    expect(source).toMatch(/--arg sha "\$WORKFLOW_RUN_HEAD_SHA"/);
    expect(source).toMatch(/select\(\.target_commitish == \$sha\)/);
  });

  it("exits green without publishing when the upstream run created no release (BSOD-775)", () => {
    // The `releases_created` guard that used to live in the job-level
    // `if:` could never be evaluated (the `workflow_run` payload has no
    // `outputs` field), so a Release Please run that created no release
    // (a `docs:`-only push) still resolved a release and published it.
    // The no-release case is a legitimate no-op: exit 0 (green) and
    // publish nothing.
    expect(source).toMatch(/created no release/);
    expect(source).toMatch(/echo "publish=false"/);
    expect(source).toMatch(/exit 0/);
  });

  it("keeps the API-failure hard-fail separate from the no-release exit (BSOD-775)", () => {
    // Two different conditions, two different outcomes:
    //   * the Releases API call failed -> hard fail (`exit 1`), the
    //     workflow must not silently publish an unversioned image;
    //   * the API call succeeded but no release matches this run's
    //     commit -> no-op (`exit 0`), nothing is published.
    // They must not collapse into one another.
    expect(source).toMatch(/Refusing to publish an unversioned image/);
    expect(source).toMatch(/exit 1/);
    expect(source).toMatch(/\|\| RELEASES_JSON=""/);
  });

  it("publishes the commit the release was tagged with, not the run head (BSOD-775)", () => {
    // The image content must match the version it is tagged with, so
    // the checked-out commit is the release's own `target_commitish`.
    expect(source).toMatch(/echo "commit_sha=\$RELEASE_SHA"/);
    expect(source).not.toMatch(/echo "commit_sha=\$WORKFLOW_RUN_HEAD_SHA"/);
  });

  it("gates every publishing step on the publish flag (BSOD-775)", () => {
    // The no-release case must publish NOTHING: every step from the
    // checkout to the push has to be skipped when `publish=false`.
    const gates =
      source.match(/steps\.inputs\.outputs\.publish != 'false'/g) ?? [];
    expect(gates.length).toBeGreaterThanOrEqual(7);
    // ... including the build/push step itself.
    expect(source).toMatch(
      /if:[^\n]*steps\.inputs\.outputs\.publish != 'false'[^\n]*steps\.check\.outputs\.already_published != 'true'/,
    );
  });

  it("skips the publish when the tagged commit cannot be checked out (BSOD-775)", () => {
    // Never publish content that does not match the version tag: if the
    // tagged commit cannot be fetched, the publish is skipped (green)
    // instead of falling back to some other commit.
    expect(source).toMatch(/continue-on-error:\s*true/);
    expect(source).toMatch(/steps\.checkout\.outcome == 'success'/);
    expect(source).toMatch(/steps\.checkout\.outcome != 'success'/);
  });

  it("logs the no-release outcome (the log step is not gated on the publish flag)", () => {
    // The "Log resolved inputs" step has to run even when nothing is
    // published, so the run shows why it ended without a publish.
    expect(source).toMatch(
      /LOG_PUBLISH:\s*\$\{\{\s*steps\.inputs\.outputs\.publish\s*\}\}/,
    );
    expect(source).toMatch(/[Nn]othing to publish/);
  });

  it("derives the prerelease flag from the tag semver on the workflow_run path (BSOD-466)", () => {
    // BSOD-466: the upstream `prerelease` output is gone together with
    // the rest of the `workflow_run.outputs.*` reads, so the workflow_run
    // branch leaves `prerelease` empty and
    // `scripts/resolve-docker-tags.mjs` derives it from the tag's semver
    // (a `-` segment means pre-release) — exactly like the
    // workflow_dispatch branch. A `v1.0.0-rc.1` tag therefore never
    // pushes `latest`, even from a run on `main`.
    expect(source).not.toMatch(/WORKFLOW_RUN_PRERELEASE/);
    expect(source).toMatch(/echo "prerelease="/);
    expect(source).not.toMatch(/echo "prerelease=\$DISPATCH_PRERELEASE"/);
  });

  it("hard-fails when the workflow_run release cannot be resolved (no unversioned image)", () => {
    // Defense-in-depth: if the GitHub Releases API cannot tell us which
    // release to publish (API error, malformed response, ...), the
    // workflow must NOT silently publish a `:latest` retag. The shell
    // step asserts the resolved release is non-empty before writing
    // `$GITHUB_OUTPUT`.
    expect(source).toMatch(/Refusing to publish an unversioned image/);
    expect(source).toMatch(/exit 1/);
  });

  it("checks out the release's own commit on the workflow_run path so we don't race the upstream tag push", () => {
    // The commit is resolved from the release itself (BSOD-775), so the
    // image content always matches the version it is tagged with. We
    // still prefer a SHA over a tag ref, because the tag may not yet be
    // visible on `origin` when this downstream workflow fires, and a
    // `ref: <tag>` checkout would race against the upstream's tag push.
    expect(source).toMatch(
      /ref:\s*\$\{\{\s*steps\.inputs\.outputs\.commit_sha\s*\|\|\s*steps\.inputs\.outputs\.tag_name\s*\}\}/,
    );
  });

  it("requests contents: read and packages: write permissions (no unnecessary write scopes)", () => {
    expect(source).toMatch(/^\s{2}contents:\s*read\s*$/m);
    expect(source).toMatch(/^\s{2}packages:\s*write\s*$/m);
    expect(source).not.toMatch(/^\s{2}id-token:/m);
  });

  it("defines a single `docker` job running on ubuntu-latest", () => {
    expect(source).toMatch(/^\s{2}docker:\s*$/m);
    expect(source).toMatch(/^\s{4}name:\s*Build & push image\s*$/m);
    expect(source).toMatch(/^\s{4}runs-on:\s*ubuntu-latest\s*$/m);
  });

  it("pins every third-party action to a 40-char commit SHA with a `# vX.Y.Z` comment", () => {
    const pinnedRegex =
      /^(?<action>[\w-]+\/[\w-]+)@(?<sha>[a-f0-9]{40}) # v(?<v>\d+\.\d+\.\d+(?:\.\d+)?)$/;
    const expected: Array<[string, RegExp]> = [
      ["actions/checkout", /actions\/checkout@[a-f0-9]{40} # v\d+\.\d+\.\d+/],
      [
        "docker/setup-buildx-action",
        /docker\/setup-buildx-action@[a-f0-9]{40} # v\d+\.\d+\.\d+/,
      ],
      [
        "docker/login-action",
        /docker\/login-action@[a-f0-9]{40} # v\d+\.\d+\.\d+/,
      ],
      [
        "docker/build-push-action",
        /docker\/build-push-action@[a-f0-9]{40} # v\d+\.\d+\.\d+/,
      ],
    ];
    for (const [name, regex] of expected) {
      const m = source.match(regex);
      expect(m, `unpinned ${name} reference`).not.toBeNull();
      const line = m?.[0];
      expect(line).toMatch(pinnedRegex);
    }
  });

  it("checks out the tag by name (not HEAD of main) with fetch-depth 1", () => {
    expect(source).toMatch(/-\s+name:\s*Check out the tagged commit\s*$/m);
    expect(source).toMatch(
      /uses:\s*actions\/checkout@[a-f0-9]{40} # v\d+\.\d+\.\d+/,
    );
    expect(source).toMatch(
      /ref:\s*\$\{\{\s*steps\.inputs\.outputs\.commit_sha\s*\|\|\s*steps\.inputs\.outputs\.tag_name\s*\}\}/,
    );
    expect(source).toMatch(/fetch-depth:\s*1/);
  });

  it("delegates tag computation to scripts/resolve-docker-tags.mjs (and the script exists)", () => {
    expect(source).toMatch(/scripts\/resolve-docker-tags\.mjs/);
    expect(existsSync(scriptPath)).toBe(true);
    expect(readFileSync(scriptPath, "utf8").length).toBeGreaterThan(0);
  });

  it("captures the source commit SHA from `git rev-parse HEAD` and surfaces it in the log", () => {
    expect(source).toMatch(/git rev-parse HEAD/);
    expect(source).toMatch(/commit_sha=\$SHA/);
    expect(source).toMatch(/Source commit: \$SHA/);
  });

  it("logs in to ghcr.io with the workflow GITHUB_TOKEN (no long-lived secrets)", () => {
    expect(source).toMatch(
      /uses:\s*docker\/login-action@[a-f0-9]{40} # v\d+\.\d+\.\d+/,
    );
    expect(source).toMatch(/registry:\s*ghcr\.io/);
    expect(source).toMatch(/password:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
  });

  it("builds from docker/Dockerfile (the BSOD-139 multi-stage Dockerfile) with push: true", () => {
    expect(source).toMatch(
      /uses:\s*docker\/build-push-action@[a-f0-9]{40} # v\d+\.\d+\.\d+/,
    );
    expect(source).toMatch(/context:\s*\.\s*$/m);
    expect(source).toMatch(/file:\s*docker\/Dockerfile\s*$/m);
    expect(source).toMatch(/push:\s*true/);
    expect(existsSync(dockerfilePath)).toBe(true);
  });

  it("threads the computed image refs into the build-push-action tags input", () => {
    expect(source).toMatch(
      /tags:\s*\$\{\{\s*steps\.tags\.outputs\.image_refs\s*\}\}/,
    );
  });

  it("embeds OCI source/version/revision labels for provenance", () => {
    expect(source).toMatch(/org\.opencontainers\.image\.title=team-dash/);
    expect(source).toMatch(
      /org\.opencontainers\.image\.version=\$\{\{\s*steps\.tags\.outputs\.version\s*\}\}/,
    );
    expect(source).toMatch(
      /org\.opencontainers\.image\.revision=\$\{\{\s*steps\.source\.outputs\.commit_sha\s*\}\}/,
    );
    expect(source).toMatch(
      /org\.opencontainers\.image\.source=\$\{\{\s*github\.server_url\s*\}\}/,
    );
  });

  it("never calls fromJSON() on a possibly-empty output inside a step-level env block (BSOD-776)", () => {
    // BSOD-776: a step-level `env:` block is materialised even when the
    // step's own `if:` gate is false — the gate protects the step's
    // *body*, not its *environment*. The idempotency step therefore
    // evaluated `fromJSON(steps.tags.outputs.tags_json)` on the
    // no-release path, where `tags_json` is the empty string, and
    // failed the whole job with "The template is not valid. ... Error
    // reading JToken from JsonReader" — turning every ordinary push to
    // `main` into a red `Docker Release` run.
    //
    // Rule: a step-level `env:` value may only call `fromJSON()` when
    // the call is short-circuited by an explicit emptiness check.
    const blocks = collectStepEnvBlocks(source);
    expect(
      blocks.length,
      "test setup error: expected at least one step-level env: block",
    ).toBeGreaterThan(0);

    for (const block of blocks) {
      for (const value of block.values) {
        if (!value.includes("fromJSON(")) continue;
        const guarded = /!=\s*''\s*&&\s*fromJSON\(/.test(value);
        expect(
          guarded,
          `step-level env value in step "${block.step}" (line ${block.startLine}) calls fromJSON() without an emptiness guard: ${value}`,
        ).toBe(true);
      }
    }

    // The concrete failure mode is gone: nothing parses the (possibly
    // empty) tags payload with fromJSON any more.
    expect(source).not.toMatch(/fromJSON\(steps\.tags\.outputs\.tags_json\)/);
  });

  it("reads the image version from a single source in both the idempotency check and the OCI labels (BSOD-776)", () => {
    // BSOD-776: the two former `fromJSON(steps.tags.outputs.tags_json)`
    // call sites could drift apart (and did — one of them was only one
    // gate change away from failing the same way). The version is now
    // computed once, by the step that already resolves the tags, and
    // both consumers read that single step output.
    expect(source).toMatch(/echo "version=\$VERSION"/);
    expect(source).toMatch(
      /VERSION:\s*\$\{\{\s*steps\.tags\.outputs\.version\s*\}\}/,
    );
    expect(source).toMatch(
      /org\.opencontainers\.image\.version=\$\{\{\s*steps\.tags\.outputs\.version\s*\}\}/,
    );
    // The version is derived from the payload the tag-resolver script
    // produced, not re-parsed from a raw JSON string.
    expect(source).toMatch(/jq -r '\.version \/\/ ""'/);
  });

  it("has an idempotent skip step gated on a buildx imagetools inspect of the version tag", () => {
    expect(source).toMatch(/docker buildx imagetools inspect/);
    expect(source).toMatch(/already_published=true/);
    expect(source).toMatch(/already_published=false/);
    // The build/push step is gated on the idempotency check (and, since
    // BSOD-775, on the publish flag / a successful checkout).
    expect(source).toMatch(
      /if:[^\n]*steps\.check\.outputs\.already_published != 'true'/,
    );
  });

  it("echoes the resolved tag_name, prerelease, on_main, and image refs to the CI log", () => {
    expect(source).toMatch(/Resolved Docker image inputs:/);
    expect(source).toMatch(/Image refs to push:/);
    expect(source).toMatch(/Computed tags payload:/);
  });

  it("does not introduce long-lived secrets or non-ghcr registries", () => {
    // secrets.* other than GITHUB_TOKEN, or non-ghcr registries, would
    // expand the credential surface without justification.
    expect(source).not.toMatch(/secrets\.(?!GITHUB_TOKEN)/);
    expect(source).not.toMatch(/docker\.io/);
    expect(source).not.toMatch(/quay\.io/);
    expect(source).not.toMatch(/registry-1\.docker\.io/);
    expect(source).not.toMatch(/amazonaws\.com/);
  });

  it("never interpolates ${{ inputs.* }} directly into a `run:` block (script-injection guard)", () => {
    // GitHub-Actions script-injection mitigation: any untrusted input
    // (workflow_dispatch inputs, event payloads) must be threaded through
    // `env:` and referenced as `$VAR`, not interpolated into the shell
    // command itself. The release-event branch already follows this
    // pattern; the workflow_dispatch branch must mirror it.
    expect(source).not.toMatch(/run:[^\n]*\$\{\{\s*inputs\./);
    // Same guard for the event payloads on the release branch — the
    // existing code uses `env: RELEASE_TAG_NAME: ${{ ... }}` and then
    // `$RELEASE_TAG_NAME` in shell, so we expect *no* `${{ github.event.* }}`
    // tokens inside a `run:` block either.
    expect(source).not.toMatch(/run:[^\n]*\$\{\{\s*github\.event\./);
  });

  it("never interpolates any ${{ ... }} expression into a `run:` block (broader script-injection guard)", () => {
    // PR-Review follow-up: a token-specific denylist (inputs./github.event.)
    // misses transitive-taint cases like steps.inputs.outputs.tag_name,
    // which is set verbatim from the dispatch input upstream and would
    // re-introduce the same injection class one hop downstream. The
    // contract this workflow enforces is the broader one: nothing from
    // a `${{ ... }}` expression ever lands in a `run:` shell string —
    // every value, even repo metadata like `github.repository_owner`, is
    // threaded through `env:` and referenced as `$VAR`. That makes the
    // rule a structural invariant, not a regex over a denylist.
    //
    // We collect every `run:` block (block-scalar `|` / `>` / `|-` / `>+`
    // / etc., and the less-common inline `run: <single-line>` form) by
    // walking line-by-line, and assert none of the shell lines inside
    // contains a `${{` opener.
    const lines = source.split("\n");

    type RunBlock = { startLine: number; body: string[] };
    const blocks: RunBlock[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const header = lines[i] ?? "";

      // Inline form: `- run: <...>` on a single line (no block scalar).
      const inline = /^\s*-\s*run:\s*(.+?)\s*$/.exec(header);
      if (inline) {
        blocks.push({ startLine: i + 1, body: [inline[1] ?? ""] });
        continue;
      }

      // Block-scalar form: any indented line ending in `run: |` or
      // `run: >` (with optional chomping indicator `-` / `+`).
      const blockHeader = /^(\s*)run:\s*(?:\|[-+]?|>[-+]?)\s*$/.exec(header);
      if (!blockHeader) continue;
      const blockIndent = (blockHeader[1] ?? "") + "  ";
      const body: string[] = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const line = lines[j] ?? "";
        if (line.trim() === "") {
          body.push(line);
          continue;
        }
        if (line.startsWith(blockIndent)) {
          body.push(line);
          continue;
        }
        // Line is less indented than the block → block ended.
        break;
      }
      blocks.push({ startLine: i + 1, body });
    }

    expect(
      blocks.length,
      "test setup error: expected at least one `run:` block in the workflow",
    ).toBeGreaterThan(0);

    for (const block of blocks) {
      const joined = block.body.join("\n");
      expect(
        joined.includes("${{"),
        `\`run:\` block starting on line ${block.startLine} contains a literal ${{}} interpolation:\n${joined}`,
      ).toBe(false);
    }
  });

  it("threads the workflow_dispatch tag_name and source_branch inputs through env vars", () => {
    expect(source).toMatch(
      /DISPATCH_TAG_NAME:\s*\$\{\{\s*inputs\.tag_name\s*\}\}/,
    );
    expect(source).toMatch(
      /DISPATCH_SOURCE_BRANCH:\s*\$\{\{\s*inputs\.source_branch\s*\}\}/,
    );
  });

  it("sets a timeout-minutes on the docker job", () => {
    expect(source).toMatch(/^\s{4}timeout-minutes:\s*\d+\s*$/m);
  });

  it("leaves prerelease empty on the workflow_dispatch branch so the script derives it from the semver", () => {
    // Dispatch path emits `prerelease=` (empty) so the script's
    // coerceBool returns undefined and resolveDockerTags falls back to
    // checking the tag's `-` segment — which means a re-publish of a
    // pre-release tag (e.g. `v1.0.0-rc.1`) does NOT push `latest` even
    // when source_branch=main.
    expect(source).toContain('echo "prerelease="');
  });

  it("does not hardcode `prerelease=false` on the workflow_dispatch branch", () => {
    // AC4 regression guard: the original v1 hardcoded prerelease=false in
    // the dispatch branch, which would have silently pushed `latest` for
    // any pre-release tag re-dispatched with source_branch=main.
    expect(source).not.toMatch(/prerelease=false/);
  });

  it("uses the YAML keys expected by GitHub Actions at the top level", () => {
    expect(topLevelKeys(source).sort()).toEqual(
      ["jobs", "name", "on", "permissions"].sort(),
    );
  });
});
