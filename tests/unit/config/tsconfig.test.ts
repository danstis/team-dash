import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CompilerOptions } from "typescript";

interface TsConfig {
  compilerOptions: CompilerOptions;
  include?: string[];
  exclude?: string[];
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

let config: TsConfig;

beforeAll(() => {
  const raw = readFileSync(resolve(repoRoot, "tsconfig.json"), "utf8");
  // Strip JSON5 comments so we can parse with JSON.parse (TS accepts JSON5 but Node's JSON.parse does not).
  const stripped = raw
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  config = JSON.parse(stripped) as TsConfig;
});

describe("tsconfig.json (T004)", () => {
  it("parses as a valid tsconfig", () => {
    expect(config).toBeTypeOf("object");
    expect(config.compilerOptions).toBeTypeOf("object");
  });

  it("enables strict mode (Constitution Principle VI determinism)", () => {
    expect(config.compilerOptions.strict).toBe(true);
  });

  it("targets ES2022 (plan.md Technical Context)", () => {
    expect(config.compilerOptions.target).toBe("ES2022");
  });

  it("uses bundler-style module resolution (Vite interop)", () => {
    expect(config.compilerOptions.moduleResolution).toBe("Bundler");
  });

  it('uses bundler-style module output (ESM, matches package.json "type":"module")', () => {
    expect(config.compilerOptions.module).toBe("ESNext");
  });

  it("keeps type-checking only (Vite emits)", () => {
    expect(config.compilerOptions.noEmit).toBe(true);
  });

  it("uses React 19 automatic JSX runtime", () => {
    expect(config.compilerOptions.jsx).toBe("react-jsx");
  });

  it("enables isolated modules (required by Vite/SWC)", () => {
    expect(config.compilerOptions.isolatedModules).toBe(true);
  });

  describe("path aliases", () => {
    const requiredAliases: Record<string, string> = {
      "@app/*": "src/app",
      "@features/*": "src/features",
      "@domain/*": "src/domain",
      "@data/*": "src/data",
      "@shared/*": "src/shared",
      "@/*": "src",
    };

    it("declares every alias required by plan.md Project Structure", () => {
      const paths = config.compilerOptions.paths ?? {};
      for (const alias of Object.keys(requiredAliases)) {
        expect(paths, `missing alias "${alias}"`).toHaveProperty(alias);
      }
    });

    it.each(Object.entries(requiredAliases))(
      'maps "%s" to an existing directory under repo root',
      (alias, _target) => {
        const paths = config.compilerOptions.paths ?? {};
        const entries = paths[alias];
        expect(entries, `alias "${alias}" must be an array`).toBeInstanceOf(
          Array,
        );
        const first = (entries as string[])[0]!;
        const resolved = resolve(repoRoot, first.replace(/\*$/, ""));
        expect(
          existsSync(resolved),
          `alias "${alias}" points at "${first}" but ${resolved} does not exist`,
        ).toBe(true);
      },
    );

    it("declares no alias that does not match a real src/ subdirectory", () => {
      const paths = config.compilerOptions.paths ?? {};
      for (const [alias, entries] of Object.entries(paths)) {
        const first = (entries as string[])[0]!;
        const resolved = resolve(repoRoot, first.replace(/\*$/, ""));
        expect(
          existsSync(resolved),
          `alias "${alias}" points at "${first}" but ${resolved} does not exist`,
        ).toBe(true);
      }
    });
  });

  describe("include globs", () => {
    it("includes the src/ tree", () => {
      expect(config.include ?? []).toContain("src");
    });

    it("includes the tests/ tree", () => {
      expect(config.include ?? []).toContain("tests");
    });

    it("includes the fixtures/ tree", () => {
      expect(config.include ?? []).toContain("fixtures");
    });

    it("includes root-level *.config.ts (vite/eslint/vitest/playwright configs)", () => {
      expect(config.include ?? []).toContain("*.config.ts");
    });
  });
});
