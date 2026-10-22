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

const PLUGIN_RULE_ID = "no-restricted-imports";

async function lintFixtureFile(
  relativeFilePath: string,
): Promise<{ filePath: string; ruleIds: string[]; messages: string[] }> {
  // Re-scope the real src/domain/** rule onto the fixture tree so
  // `npm run lint` does not trip over the deliberately-bad fixtures.
  const [domainBlock] = (await import(eslintConfigPath)).default.filter(
    (block: { files?: string[] }) => block.files?.[0] === "src/domain/**",
  );
  const eslint = new ESLint({
    overrideConfigFile: eslintConfigPath,
    overrideConfig: {
      ...domainBlock,
      files: ["tests/fixtures/eslint-boundary/domain/**"],
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

    const selectors = JSON.stringify(ruleEntry[1]);
    expect(selectors).toContain("**/features/**");
    expect(selectors).toContain("**/data/asana/**");
    expect(selectors).toContain('"react"');
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

  it("flags a domain module that imports from react-dom", async () => {
    const result = await lintFixtureFile(
      "domain/imports/domain-imports-react-dom.js",
    );

    expect(result.ruleIds).toContain(PLUGIN_RULE_ID);
  });

  it("flags a domain module that imports from react/jsx-runtime", async () => {
    const result = await lintFixtureFile(
      "domain/imports/domain-imports-react-jsx-runtime.js",
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
    const result = await lintFixtureFile("data/imports/data-imports-domain.js");

    expect(result.ruleIds).not.toContain(PLUGIN_RULE_ID);
  });
});
