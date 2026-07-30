/**
 * Visual QA capture for `WorkspaceSelector`.
 *
 * One-off test that renders every state of the new
 * `WorkspaceSelector` component and writes the rendered DOM (as a
 * standalone HTML fragment) to `tmp/visual-qa/`. The HTML files
 * produced are intended to be attached to PR #102 as visual
 * evidence for the Release/Link Steward's review.
 *
 * This file lives under `tests/visual/` rather than `tests/unit/`
 * because it is tooling for a PR, not an evergreen test — the
 * coverage it provides is asserted by attaching the artefacts, not
 * by CI assertions.
 */
import {
  cleanup,
  render,
} from "@testing-library/react";
import {
  type ReactElement,
  createElement,
  StrictMode,
} from "react";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, it, vi } from "vitest";

vi.mock("../../src/app/workspace-context", () => ({
  useWorkspace: () => workspaceContextMock,
}));

import { WorkspaceSelector } from "../../src/features/credentials/WorkspaceSelector";
import type { WorkspaceOption } from "../../src/features/credentials/WorkspaceSelector";
import type { SelectedWorkspace } from "../../src/app/workspace-context";

const workspaceContextMock: {
  state: "ready" | "first_run";
  workspace: SelectedWorkspace | null;
  selectWorkspace: () => Promise<void>;
  clearSelection: () => Promise<void>;
} = {
  state: "ready",
  workspace: null,
  selectWorkspace: async () => undefined,
  clearSelection: async () => undefined,
};

const WORKSPACES: readonly WorkspaceOption[] = [
  {
    gid: "1200000000000001",
    name: "Acme Production",
    resource_type: "workspace",
    is_organization: true,
  },
  {
    gid: "1200000000000002",
    name: "Acme Sandbox",
    resource_type: "workspace",
    is_organization: false,
  },
  {
    gid: "1200000000000003",
    name: "Personal Side Project",
    resource_type: "workspace",
  },
];

const OUTPUT_DIR = resolve(process.cwd(), "tmp/visual-qa");

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <title>WorkspaceSelector — ${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      margin: 0;
      padding: 32px;
      background: #f7f7f9;
      color: #1d1d1f;
    }
    h1 {
      font-size: 18px;
      margin: 0 0 4px;
    }
    p.qa-meta {
      color: #6b6b75;
      font-size: 13px;
      margin: 0 0 24px;
    }
    .qa-frame {
      background: white;
      border: 1px solid #d1d1d6;
      border-radius: 8px;
      padding: 24px;
      max-width: 560px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    }
    fieldset.td-workspace-selector,
    section.td-workspace-selector {
      border: 1px solid #d1d1d6;
      border-radius: 6px;
      padding: 12px 16px;
      margin: 0;
    }
    fieldset.td-workspace-selector legend,
    section.td-workspace-selector h3 {
      font-weight: 600;
      padding: 0 8px;
    }
    fieldset.td-workspace-selector p,
    section.td-workspace-selector output {
      margin: 8px 0;
      font-size: 14px;
    }
    select {
      font: inherit;
      padding: 6px 10px;
      border: 1px solid #c5c5cc;
      border-radius: 4px;
      background: white;
      min-width: 280px;
    }
    button {
      font: inherit;
      padding: 6px 14px;
      border-radius: 4px;
      border: 1px solid #0a6cff;
      background: #0a6cff;
      color: white;
      cursor: pointer;
      margin-top: 12px;
    }
    button[disabled] {
      background: #d1d1d6;
      border-color: #d1d1d6;
      color: #6b6b75;
      cursor: not-allowed;
    }
    fieldset[disabled] {
      opacity: 0.6;
    }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p class="qa-meta">WorkspaceSelector (T043, BSOD-171) — rendered DOM captured at PR-revision time.</p>
  <div class="qa-frame">
    ${body}
  </div>
</body>
</html>
`;
}

interface CaptureSpec {
  readonly slug: string;
  readonly title: string;
  readonly workspaces: readonly WorkspaceOption[];
  readonly contextWorkspace: SelectedWorkspace | null;
}

const SPECS: readonly CaptureSpec[] = [
  {
    slug: "01-empty-state",
    title: "Empty state — token has no accessible workspaces",
    workspaces: [],
    contextWorkspace: null,
  },
  {
    slug: "02-populated-default",
    title: "Populated — three workspaces, none selected",
    workspaces: WORKSPACES,
    contextWorkspace: null,
  },
  {
    slug: "03-populated-pre-selected",
    title: "Populated — three workspaces, Acme Sandbox pre-selected from context",
    workspaces: WORKSPACES,
    contextWorkspace: {
      gid: WORKSPACES[1].gid,
      name: WORKSPACES[1].name,
      selectedAt: "2026-07-25T10:00:00.000Z" as never,
    },
  },
];

describe("WorkspaceSelector visual QA — review artefacts", () => {
  it("emits one HTML artefact per state to tmp/visual-qa/", () => {
    mkdirSync(OUTPUT_DIR, { recursive: true });

    for (const spec of SPECS) {
      workspaceContextMock.workspace = spec.contextWorkspace;
      const result = render(
        createElement(
          StrictMode,
          null,
          createElement(WorkspaceSelector, {
            workspaces: spec.workspaces as WorkspaceOption[],
          }) as ReactElement,
        ) as ReactElement,
      );
      const body = result.container.outerHTML;
      writeFileSync(
        resolve(OUTPUT_DIR, `${spec.slug}.html`),
        page(spec.title, body),
        "utf8",
      );
      cleanup();
    }
  });
});

afterAll(() => {
  // No-op teardown — the artefacts on disk are intentional output.
});