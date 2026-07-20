import { fileURLToPath } from "node:url";
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const eslintConfigPath = path.join(repoRoot, "eslint.config.js");
const fixturesRoot = path.join(repoRoot, "tests/fixtures/eslint-boundary");

const PLUGIN_RULE_ID = "boundaries/dependencies";

async function lintFixtureFile(
  relativeFilePath: string,
): Promise<{ filePath: string; ruleIds: string[]; messages: string[] }> {
  const eslint = new ESLint({
    overrideConfigFile: eslintConfigPath,
    overrideConfig: {
      settings: {
        "boundaries/elements": [
          {
            type: "domain",
            pattern: [
              "**/src/domain/**",
              "**/tests/fixtures/eslint-boundary/domain/**",
            ],
          },
          {
            type: "features",
            pattern: [
              "**/src/features/**",
              "**/tests/fixtures/eslint-boundary/features/**",
            ],
          },
          {
            type: "data-asana",
            pattern: [
              "**/src/data/asana/**",
              "**/tests/fixtures/eslint-boundary/data/asana/**",
            ],
          },
          {
            type: "data",
            pattern: [
              "**/src/data/**",
              "**/tests/fixtures/eslint-boundary/data/**",
            ],
          },
          {
            type: "app",
            pattern: ["**/src/app/**"],
          },
          {
            type: "shared",
            pattern: ["**/src/shared/**"],
          },
        ],
      },
    },
    cwd: repoRoot,
  });

  const targetPath = path.join(fixturesRoot, relativeFilePath);
  const results = await eslint.lintFiles([targetPath]);
  const [result] = results;

  return {
    filePath: result.filePath,
    ruleIds: result.messages.map((message) => message.ruleId ?? ""),
    messages: result.messages.map((message) => message.message),
  };
}

describe("ESLint flat configuration", () => {
  it("loads eslint.config.js as the only configuration file (ESLint 10 flat config)", async () => {
    const eslint = new ESLint({
      overrideConfigFile: eslintConfigPath,
      cwd: repoRoot,
    });

    const config = await eslint.calculateConfigForFile(
      path.join(repoRoot, "src/domain/metrics/example.ts"),
    );

    expect(typeof config).toBe("object");
    expect(config.rules).toBeDefined();
    expect(config.rules[PLUGIN_RULE_ID]).toBeDefined();
  });

  it("declares the architecture layers src/domain, src/features, src/data, src/data/asana, src/app, and src/shared as boundaries elements", async () => {
    const eslint = new ESLint({
      overrideConfigFile: eslintConfigPath,
      cwd: repoRoot,
    });

    const config = await eslint.calculateConfigForFile(
      path.join(repoRoot, "src/domain/metrics/example.ts"),
    );

    const elementTypes = (
      config.settings["boundaries/elements"] as Array<{ type: string }>
    ).map((descriptor) => descriptor.type);

    expect(elementTypes).toEqual(
      expect.arrayContaining([
        "domain",
        "features",
        "data-asana",
        "data",
        "app",
        "shared",
      ]),
    );
  });

  it("blocks src/domain/** from importing src/features/**, src/data/asana/**, or React", async () => {
    const eslint = new ESLint({
      overrideConfigFile: eslintConfigPath,
      cwd: repoRoot,
    });

    const config = await eslint.calculateConfigForFile(
      path.join(repoRoot, "src/domain/metrics/example.ts"),
    );

    const ruleEntry = config.rules[PLUGIN_RULE_ID] as unknown as [
      number,
      Record<string, unknown>,
    ];
    expect(ruleEntry[0]).toBe(2);

    const options = ruleEntry[1];
    const policies = options.policies as Array<Record<string, unknown>>;

    const domainPolicy = policies.find((policy) => {
      const from = policy.from as { element?: { type?: string } };
      return from?.element?.type === "domain";
    });
    expect(domainPolicy).toBeDefined();

    const disallow = (domainPolicy!.disallow as { to: unknown[] }).to;
    const disallowSelectors = JSON.stringify(disallow);
    expect(disallowSelectors).toContain("features");
    expect(disallowSelectors).toContain("data-asana");
    expect(disallowSelectors).toContain("react");
  });

  it("does not flag a domain module that only imports from other domain modules", async () => {
    const result = await lintFixtureFile(
      "domain/imports/domain-only-imports.js",
    );

    expect(result.ruleIds).not.toContain(PLUGIN_RULE_ID);
  });

  it("flags a domain module that imports from src/features/**", async () => {
    const result = await lintFixtureFile(
      "domain/imports/domain-imports-features.js",
    );

    expect(result.ruleIds).toContain(PLUGIN_RULE_ID);
  });

  it("flags a domain module that imports from react", async () => {
    const result = await lintFixtureFile(
      "domain/imports/domain-imports-react.js",
    );

    expect(result.ruleIds).toContain(PLUGIN_RULE_ID);
  });

  it("flags a domain module that imports from src/data/asana/**", async () => {
    const result = await lintFixtureFile(
      "domain/imports/domain-imports-asana.js",
    );

    expect(result.ruleIds).toContain(PLUGIN_RULE_ID);
  });

  it("allows src/features/** to import from src/data/asana/**", async () => {
    const result = await lintFixtureFile(
      "features/imports/features-imports-asana.js",
    );

    expect(result.ruleIds).not.toContain(PLUGIN_RULE_ID);
  });

  it("allows src/data/** to import from src/domain/**", async () => {
    const result = await lintFixtureFile(
      "data/imports/data-imports-domain.js",
    );

    expect(result.ruleIds).not.toContain(PLUGIN_RULE_ID);
  });
});
