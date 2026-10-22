import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const renovateConfigPath = resolve(repoRoot, "renovate.json");

interface RenovatePackageRule {
  matchUpdateTypes?: string[];
  automerge?: boolean;
  minimumReleaseAge?: string | null;
}

interface RenovateConfig {
  minimumReleaseAge?: string | null;
  internalChecksFilter?: string;
  osvVulnerabilityAlerts?: boolean;
  vulnerabilityAlerts?: { enabled?: boolean };
  packageRules?: RenovatePackageRule[];
}

const config = JSON.parse(
  readFileSync(renovateConfigPath, "utf8"),
) as RenovateConfig;

const MINIMUM_COOLDOWN_MINUTES = 3 * 24 * 60; // 3 days

/**
 * Parses the human-readable durations Renovate accepts for `minimumReleaseAge`
 * ("30 minutes", "6 hours", "3 days", "1 week") into minutes so the test can
 * assert the cooldown is at least X rather than pinned to one literal string.
 */
function durationToMinutes(value: string): number | null {
  const match = /^\s*(\d+)\s*(minute|hour|day|week)s?\s*$/i.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = (match[2] ?? "").toLowerCase();
  const perUnit: Record<string, number> = {
    minute: 1,
    hour: 60,
    day: 24 * 60,
    week: 7 * 24 * 60,
  };
  return amount * (perUnit[unit] ?? 0);
}

describe("renovate.json (BSOD-467)", () => {
  it("sets a release-age cooldown so fresh versions cannot auto-merge", () => {
    // BSOD-467: `config:recommended` does not set `minimumReleaseAge`, so a
    // malicious patch release published minutes ago could be merged to `main`
    // as soon as CI went green. Every npm account-takeover incident of the
    // last years (chalk/debug, Shai-Hulud, eslint-config-prettier) had that
    // shape. The cooldown is the control that keeps them out.
    expect(typeof config.minimumReleaseAge).toBe("string");
    const raw = (config.minimumReleaseAge ?? "").trim();
    expect(raw.length).toBeGreaterThan(0);
    expect(durationToMinutes(raw)).not.toBeNull();
  });

  it("keeps at least a 3-day cooldown", () => {
    const minutes = durationToMinutes((config.minimumReleaseAge ?? "").trim());
    expect(minutes).not.toBeNull();
    expect(minutes ?? 0).toBeGreaterThanOrEqual(MINIMUM_COOLDOWN_MINUTES);
  });

  it("holds the PR until the release-age check passes (internalChecksFilter=strict)", () => {
    // With the default filter Renovate may open a PR it will not merge
    // (pending the release-age hold). `strict` keeps the internal checks in
    // force so a too-fresh version is not treated as mergeable.
    expect(config.internalChecksFilter).toBe("strict");
  });

  it("does not let a package rule cancel the cooldown", () => {
    // A `minimumReleaseAge: null` (or `enabled: false`) package rule would
    // silently defeat the top-level cooldown for the matched updates.
    const rules = config.packageRules ?? [];
    for (const rule of rules) {
      expect(rule.minimumReleaseAge ?? "set").not.toBeNull();
    }
  });

  it("still automerges minor/patch updates once the cooldown has elapsed", () => {
    // The cooldown is a delay, not a removal of the automerge flow.
    const rules = config.packageRules ?? [];
    const automergeRule = rules.find((rule) => rule.automerge === true);
    expect(automergeRule).toBeDefined();
    expect(automergeRule?.matchUpdateTypes).toEqual(
      expect.arrayContaining(["minor", "patch"]),
    );
  });

  it("does not automerge major updates (human review required)", () => {
    // BSOD-467 point 4: a major GitHub Action bump (which also moves the
    // pinned SHA) changes the version major, so it falls outside the
    // minor/patch automerge rule and is never auto-merged today.
    const rules = config.packageRules ?? [];
    for (const rule of rules) {
      if (rule.automerge !== true) continue;
      expect(rule.matchUpdateTypes ?? []).not.toContain("major");
    }
  });

  it("leaves vulnerability-alert handling untouched", () => {
    // Renovate exempts vulnerability-remediation updates from
    // `minimumReleaseAge`, so genuine security patches are not delayed.
    expect(config.osvVulnerabilityAlerts).toBe(true);
    expect(config.vulnerabilityAlerts?.enabled).toBe(true);
  });
});
