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

  it("is also re-runnable via workflow_dispatch with tag_name + source_branch inputs", () => {
    expect(source).toMatch(/^\s{2}workflow_dispatch:\s*$/m);
    expect(source).toMatch(/^\s{4}inputs:\s*$/m);
    expect(source).toMatch(/^\s{6}tag_name:\s*$/m);
    expect(source).toMatch(/^\s{8}required:\s*true\s*$/m);
    expect(source).toMatch(/^\s{6}source_branch:\s*$/m);
    expect(source).toMatch(/^\s{8}default:\s*['"]['"]\s*$/m);
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
      /ref:\s*\$\{\{\s*steps\.inputs\.outputs\.tag_name\s*\}\}/,
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
      /org\.opencontainers\.image\.version=\$\{\{\s*fromJSON\(steps\.tags\.outputs\.tags_json\)\.version\s*\}\}/,
    );
    expect(source).toMatch(
      /org\.opencontainers\.image\.revision=\$\{\{\s*steps\.source\.outputs\.commit_sha\s*\}\}/,
    );
    expect(source).toMatch(
      /org\.opencontainers\.image\.source=\$\{\{\s*github\.server_url\s*\}\}/,
    );
  });

  it("has an idempotent skip step gated on a buildx imagetools inspect of the version tag", () => {
    expect(source).toMatch(/docker buildx imagetools inspect/);
    expect(source).toMatch(/already_published=true/);
    expect(source).toMatch(/already_published=false/);
    expect(source).toMatch(
      /if:\s*steps\.check\.outputs\.already_published != 'true'/,
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
