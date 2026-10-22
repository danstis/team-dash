import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const workflowPath = resolve(repoRoot, ".github/workflows/ci.yml");
const allowlistPath = resolve(
  repoRoot,
  ".github/dependency-audit-allowlist.json",
);

const source = readFileSync(workflowPath, "utf8");

/**
 * Body of a top-level `jobs:` entry. Jobs are keyed at two-space indent,
 * so a line matching /^ {2}\S/ ends the block.
 */
function jobBlock(name: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start === -1) return "";
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^ {2}\S/.test(line)) break;
    body.push(line);
  }
  return body.join("\n");
}

/** Body of a named step inside a job block. */
function stepBlock(job: string, stepName: string): string {
  const lines = job.split("\n");
  const start = lines.findIndex(
    (line) => line.trim() === `- name: ${stepName}`,
  );
  if (start === -1) return "";
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^\s*- (name|uses|run):/.test(line)) break;
    body.push(line);
  }
  return body.join("\n");
}

/** The shell command(s) a step runs, for both inline and block-scalar forms. */
function stepRun(job: string, stepName: string): string {
  const block = stepBlock(job, stepName);
  const lines = block.split("\n");
  const header = lines.findIndex((line) =>
    /^\s*run:\s*[|>][-+]?\s*$/.test(line),
  );
  if (header !== -1) {
    const indent = (/^(\s*)/.exec(lines[header] ?? "")?.[1] ?? "") + "  ";
    const body: string[] = [];
    for (let i = header + 1; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (line.trim() === "") {
        body.push(line);
        continue;
      }
      if (line.startsWith(indent)) {
        body.push(line);
        continue;
      }
      break;
    }
    return body.join("\n");
  }
  const inline = lines.findIndex((line) => /^\s*run:\s*\S/.test(line));
  if (inline === -1) return "";
  return (lines[inline] ?? "").trim().replace(/^run:\s*/, "");
}

/** The `needs:` entries of a job. */
function jobNeeds(name: string): string[] {
  const lines = jobBlock(name).split("\n");
  const start = lines.findIndex((line) => /^ {4}needs:/.test(line));
  if (start === -1) return [];
  const collected: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (i > start && /^ {4}\S/.test(line)) break;
    collected.push(line);
  }
  const text = collected.join("\n").replace(/needs:\s*/, "");
  return (text.match(/[A-Za-z0-9_-]+/g) ?? []).filter(
    (token) => token !== "needs",
  );
}

const auditJob = jobBlock("audit");
const prodRun = stepRun(auditJob, "Audit production dependencies");
const fullRun = stepRun(auditJob, "Audit full dependency tree");

describe(".github/workflows/ci.yml — dependency-audit gate (BSOD-493)", () => {
  it("is a non-empty file under .github/workflows/", () => {
    expect(existsSync(workflowPath)).toBe(true);
    expect(source.length).toBeGreaterThan(0);
  });

  it("declares an `audit` job that needs the install job", () => {
    expect(auditJob).not.toBe("");
    expect(auditJob).toMatch(/^ {4}name:\s*Dependency audit\s*$/m);
    expect(auditJob).toMatch(/^ {4}runs-on:\s*ubuntu-latest\s*$/m);
    expect(jobNeeds("audit")).toEqual(["install"]);
  });

  it("gives the audit job read-only repository permissions", () => {
    expect(auditJob).toMatch(/^ {4}permissions:\s*$/m);
    expect(auditJob).toMatch(/^ {6}contents:\s*read\s*$/m);
    expect(auditJob).not.toMatch(/^ {6}(id-token|packages|contents:\s*write)/m);
  });

  it("pins every action used by the audit job to a commit SHA", () => {
    const uses = auditJob.match(/^\s*- uses:.*$/gm) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) {
      expect(use).toMatch(/@[a-f0-9]{40} # v\d+\.\d+\.\d+/);
    }
  });

  it("runs `npm audit` on the production dependency tree", () => {
    expect(prodRun).toContain("npm audit");
    expect(prodRun).toContain("--omit=dev");
    expect(prodRun).toContain("--audit-level=moderate");
  });

  it("runs `npm audit` on the full dependency tree", () => {
    expect(fullRun).toContain("npm audit");
    expect(fullRun).toContain("--audit-level=high");
  });

  it("holds every audit invocation to an explicit --audit-level threshold", () => {
    const invocations = auditJob
      .split("\n")
      .filter((line) => /^\s*(run:\s*)?npm audit\b/.test(line))
      .map((line) => line.trim());
    expect(invocations.length).toBeGreaterThan(0);
    for (const invocation of invocations) {
      expect(invocation).toMatch(/--audit-level=(moderate|high)/);
    }
  });

  it("never marks an audit step as continue-on-error", () => {
    // A `continue-on-error: true` audit step would report success while a
    // vulnerable lockfile sits in the tree — the exact failure mode this
    // gate exists to prevent.
    expect(auditJob).not.toMatch(/continue-on-error/);
    expect(prodRun).not.toMatch(/continue-on-error/);
    expect(fullRun).not.toMatch(/continue-on-error/);
  });

  it("keeps the production-tree audit a single blocking command", () => {
    // No `|| true`, no filtering: whatever ships in the bundle must pass
    // the audit on its own merits.
    expect(prodRun.trim()).toBe("npm audit --omit=dev --audit-level=moderate");
  });

  it("does not let the allowlist excuse a production-tree finding", () => {
    // The carve-out is scoped to the dev tree; the shipped tree is never
    // filtered.
    expect(prodRun).not.toContain("dependency-audit-allowlist");
  });

  it("applies the committed allowlist to the full-tree audit", () => {
    expect(fullRun).toContain(".github/dependency-audit-allowlist.json");
  });

  it("fails the full-tree audit on any high-severity advisory left over", () => {
    // The gate compares the advisories npm reports against the allowlist
    // and exits non-zero when something is left over.
    expect(fullRun).toMatch(/exit 1/);
    expect(fullRun).toMatch(/high|critical/);
  });

  it("fails closed when npm audit cannot complete", () => {
    // A registry/advisory-endpoint outage must not be mistaken for a clean
    // tree: the report is checked for npm's `error` shape and the job
    // fails when it is present.
    expect(fullRun).toMatch(/has\("error"\)/);
  });

  it("adds the audit job to the sonar job's needs list", () => {
    // `sonar` is the aggregate quality gate, so the audit has to be part
    // of its fan-in or a red audit would never block the pipeline.
    expect(jobNeeds("sonar")).toContain("audit");
  });

  it("does not interpolate ${{ ... }} into the audit job's run blocks", () => {
    expect(auditJob).not.toMatch(/run:[^\n]*\$\{\{/);
    expect(prodRun).not.toContain("${{");
    expect(fullRun).not.toContain("${{");
  });
});

describe(".github/dependency-audit-allowlist.json (BSOD-493)", () => {
  it("exists and is valid JSON", () => {
    expect(existsSync(allowlistPath)).toBe(true);
    expect(() => JSON.parse(readFileSync(allowlistPath, "utf8"))).not.toThrow();
  });

  it("carves out exactly one advisory", () => {
    const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8")) as {
      advisories: Record<string, unknown>;
    };
    expect(Object.keys(allowlist.advisories)).toEqual(["GHSA-vfj7-8cjw-p6xm"]);
  });

  it("records why the advisory is carved out and who owns the decision", () => {
    const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8")) as {
      advisories: Record<
        string,
        {
          package: string;
          severity: string;
          scope: string;
          reason: string;
          trackedBy: string[];
        }
      >;
    };
    const entry = allowlist.advisories["GHSA-vfj7-8cjw-p6xm"];
    expect(entry).toBeDefined();
    expect(entry.package).toBe("braces");
    expect(entry.severity).toBe("high");
    // Dev-scope only: the advisory is not reachable from the shipped
    // bundle, which is why the production tree is not filtered.
    expect(entry.scope).toBe("dev");
    expect(entry.reason.length).toBeGreaterThan(0);
    // The carve-out is temporary — it names the issues that own it so it
    // can be deleted when that decision lands.
    expect(entry.trackedBy).toContain("BSOD-692");
    expect(entry.trackedBy).toContain("BSOD-774");
  });
});
