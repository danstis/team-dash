import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const workflowsDir = resolve(repoRoot, ".github/workflows");

/** Every workflow file under `.github/workflows/`, recursively. */
function workflowFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...workflowFiles(full));
      continue;
    }
    if (/\.ya?ml$/.test(entry)) found.push(full);
  }
  return found.sort();
}

type CheckoutStep = {
  /** Path relative to the repo root, for readable failure messages. */
  file: string;
  /** 1-based line number of the `uses:` line. */
  line: number;
  /** The step's `with:` mapping, as raw (unparsed) scalar strings. */
  with: Record<string, string>;
};

/** Indentation width of a line (spaces only; tabs are not used here). */
function indentOf(line: string): number {
  return /^ */.exec(line)?.[0].length ?? 0;
}

/**
 * Collect the `with:` entries of the step that starts at `usesIndex`.
 *
 * A step is a YAML mapping: `- uses: ...` puts the key at the column of
 * `uses:`, and the step's other keys (`with:`, `if:`, ...) sit at that
 * same column — the dash is only the list marker. The step therefore
 * ends at the first line indented less than the key column.
 */
function stepInputs(
  lines: string[],
  usesIndex: number,
): Record<string, string> {
  const usesLine = lines[usesIndex] ?? "";
  const keyIndent = usesLine.indexOf("uses:");
  const body: string[] = [];
  for (let i = usesIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      body.push(line);
      continue;
    }
    if (indentOf(line) < keyIndent) break;
    body.push(line);
  }

  const withHeader = new RegExp(`^ {${keyIndent}}with:(.*)$`);
  const withIndex = body.findIndex((line) => withHeader.test(line));
  if (withIndex === -1) return {};

  // Inline flow mapping: `with: { persist-credentials: false }`.
  const inline = withHeader.exec(body[withIndex] ?? "")?.[1]?.trim() ?? "";
  if (inline.startsWith("{")) {
    const inputs: Record<string, string> = {};
    for (const pair of inline.replace(/[{}]/g, "").split(",")) {
      const entry = /^ *([A-Za-z0-9_-]+):\s*(.*)$/.exec(pair);
      if (!entry) continue;
      inputs[entry[1] ?? ""] = (entry[2] ?? "").trim();
    }
    return inputs;
  }

  const inputs: Record<string, string> = {};
  for (let i = withIndex + 1; i < body.length; i += 1) {
    const line = body[i] ?? "";
    if (line.trim() === "") continue;
    if (indentOf(line) <= keyIndent) break;
    const entry = /^ *([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!entry) continue;
    inputs[entry[1] ?? ""] = (entry[2] ?? "").trim();
  }
  return inputs;
}

/** Every `actions/checkout@...` step in a workflow file. */
function checkoutSteps(file: string): CheckoutStep[] {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  const steps: CheckoutStep[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*(?:-\s+)?uses:\s*actions\/checkout@/.test(lines[i] ?? "")) {
      continue;
    }
    steps.push({
      file: relative(repoRoot, file),
      line: i + 1,
      with: stepInputs(lines, i),
    });
  }
  return steps;
}

const files = workflowFiles(workflowsDir);
const steps = files.flatMap((file) => checkoutSteps(file));

describe(".github/workflows/** — actions/checkout credential persistence (BSOD-567)", () => {
  it("scans every workflow file under .github/workflows/", () => {
    // The guard is only worth anything if it covers the whole folder:
    // a new workflow that checks out the repo would otherwise slip past.
    expect(files.length).toBeGreaterThan(0);
    expect(files.map((file) => relative(repoRoot, file))).toEqual(
      expect.arrayContaining([".github/workflows/ci.yml"]),
    );
  });

  it("finds the actions/checkout steps in the repo's workflows", () => {
    // Test setup guard: with zero checkout steps the assertions below
    // would pass vacuously.
    expect(steps.length).toBeGreaterThan(0);
  });

  it("sets persist-credentials: false on every checkout step", () => {
    // `actions/checkout` persists the job's GITHUB_TOKEN as an
    // `AUTHORIZATION: basic <token>` header in `.git/config` by default.
    // Every step in this repo only reads the clone — no workflow pushes
    // with git — so the credential is pure exposure: it is readable by
    // any repo-controlled code that runs later in the same job (the
    // build, the Docker build, the Playwright specs) and, in
    // `docker-release.yml`, it carries `packages: write` for ghcr.io.
    for (const step of steps) {
      expect(
        step.with["persist-credentials"],
        `${step.file}:${step.line} — checkout step must set persist-credentials: false`,
      ).toBe("false");
    }
  });

  it("never enables credential persistence in a workflow", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(
        source,
        `${relative(repoRoot, file)} enables credential persistence`,
      ).not.toMatch(/persist-credentials:\s*true/);
    }
  });

  it("keeps the existing checkout inputs intact alongside the new one", () => {
    // The fix is additive: `fetch-depth` (and the tagged-commit `ref`
    // in docker-release.yml) still has to be there, or the change would
    // silently alter what the workflows check out.
    for (const step of steps) {
      expect(step.with["fetch-depth"]).toBeDefined();
    }
  });
});
