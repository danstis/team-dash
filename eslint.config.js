import tsParser from "@typescript-eslint/parser";

const DOMAIN_BOUNDARY_MESSAGE =
  "src/domain/** must stay presentation-free, browser-free, and network-free per Constitution Principle VI; importing from src/features/**, src/data/asana/**, or React is forbidden.";

const READ_ONLY_FETCH_MESSAGE =
  "All outbound HTTP must go through src/data/asana/client.ts (FR-009 read-only guarantee, NFR-004).";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.gitnexus/**",
      "**/playwright-report/**",
      "**/test-results/**",
      // Third-party runtime files copied verbatim from upstream packages
      // (MSW's service-worker script — copied from node_modules/msw/lib/.
      // Kept outside public/ so it never ships in production; see BSOD-450).
      "dev/mockServiceWorker.js",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
  },
  {
    // Constitution Principle VI — src/domain/** stays presentation-free,
    // browser-free, and network-free.
    files: ["src/domain/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ["react", "react-dom", "react/jsx-runtime"].map((name) => ({
            name,
            message: DOMAIN_BOUNDARY_MESSAGE,
          })),
          patterns: [
            {
              group: ["**/features/**", "**/data/asana/**"],
              message: DOMAIN_BOUNDARY_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  {
    // BSOD-468 — read-only outbound guarantee (FR-009 / NFR-004).
    //
    // `src/data/asana/client.ts` is the single legitimate outbound call
    // site in the app; the Asana client is read-only by construction.
    // Every other module under `src/` must therefore go through that
    // client, so a future feature (e.g. "mark task complete") cannot
    // quietly issue a POST/PUT/PATCH/DELETE with the user's Asana
    // personal access token. The app holds a full-scope PAT, so an
    // accidental write path would mutate the user's live workspace.
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/data/asana/**"],
    languageOptions: {
      // The global-object check below (`checkGlobalObject`) resolves
      // `window` / `self` / `globalThis` through the global scope and
      // skips names it cannot find, so they are declared here. `fetch`
      // is a web/Node API rather than an ECMAScript built-in, so it is
      // declared for the same reason (bare references to it are
      // reported either way, but declaring it keeps the rule's intent
      // explicit and self-documenting).
      globals: {
        fetch: "readonly",
        window: "readonly",
        self: "readonly",
      },
    },
    rules: {
      // Bare `fetch(...)` (or any bare `fetch` reference) outside the
      // Asana client module. `checkGlobalObject` extends the gate to
      // the member-access spellings — `window.fetch(...)`,
      // `globalThis.fetch(...)`, `self.fetch(...)` — which a bare
      // reference check cannot see, including the computed forms
      // (`window["fetch"]`).
      "no-restricted-globals": [
        "error",
        {
          globals: [
            {
              name: "fetch",
              message: READ_ONLY_FETCH_MESSAGE,
            },
          ],
          checkGlobalObject: true,
        },
      ],
    },
  },
];
