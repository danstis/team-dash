/**
 * T023 — Asana Zod resource schemas contract tests (Red/Green for T023).
 *
 * Verifies the validation boundary every Asana API response flows
 * through before it enters the cache / domain layers (FR-081 /
 * FR-082 / FR-083, `contracts/asana-client.md` "Validation boundary").
 *
 * The tests exercise two sides of every schema:
 *
 * - **Positive**: realistic Asana wire shapes (drawn from the
 *   documented endpoints and the contract's endpoint table) parse
 *   successfully and surface the exact fields the cache consumes.
 * - **Negative**: malformed / missing / wrong-type payloads produce
 *   a `ZodError` whose issues carry enough information for the
 *   client (`T025`) to surface the failure as a `validation_error`
 *   outcome. The tests assert the parser does NOT silently coerce
 *   a missing field to a default — a regression here is what
 *   FR-082 ("do not silently treat missing as zero") exists to
 *   prevent.
 *
 * The unit-level (not contract-level) placement is intentional:
 * these tests exercise the Zod schemas in isolation, no MSW / no
 * HTTP layer. The contract-level test asserting the schemas are
 * wired into `client.ts` without a write-method side channel is
 * `tests/contract/asana-client.readonly.test.ts` (T026).
 */

import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  asanaCustomFieldSchema,
  asanaCustomFieldEnumOptionSchema,
  asanaListResponseSchema,
  asanaNextPageSchema,
  asanaPortfolioItemSchema,
  asanaPortfolioItemsResponseSchema,
  asanaPortfolioListResponseSchema,
  asanaPortfolioSchema,
  asanaProjectListResponseSchema,
  asanaProjectSchema,
  asanaReferenceSchema,
  asanaSectionListResponseSchema,
  asanaSectionSchema,
  asanaSubtaskListResponseSchema,
  asanaTaskDependenciesResponseSchema,
  asanaTaskListResponseSchema,
  asanaTaskResourceSubtypeSchema,
  asanaTaskSchema,
  asanaTeamListResponseSchema,
  asanaTeamSchema,
  asanaUserListResponseSchema,
  asanaUserSchema,
  asanaWorkspaceListResponseSchema,
  asanaWorkspaceSchema,
  dependencySchema,
  gidSchema,
  isoDateSchema,
  isoDateTimeSchema,
} from "../../../../src/data/asana/schemas";

/**
 * Convenience builders so a positive-case fixture can declare just
 * the fields under test and inherit sensible defaults for the rest
 * of the resource. Keeps the test bodies focused on what is actually
 * being verified — e.g. "subtask `parent` is honoured" rather than
 * 20 lines of fixture boilerplate.
 */
type WorkspaceFixture = z.infer<typeof asanaWorkspaceSchema>;
const workspaceFixture = (
  overrides: Partial<WorkspaceFixture> = {},
): WorkspaceFixture => ({
  gid: "gid-workspace-1",
  name: "Engineering",
  resource_type: "workspace",
  is_organization: false,
  ...overrides,
});

type ProjectFixture = z.infer<typeof asanaProjectSchema>;
const projectFixture = (
  overrides: Partial<ProjectFixture> = {},
): ProjectFixture => ({
  gid: "gid-project-1",
  name: "Q3 Roadmap",
  resource_type: "project",
  archived: false,
  workspace: {
    gid: "gid-workspace-1",
    name: "Engineering",
    resource_type: "workspace",
  },
  team: {
    gid: "gid-team-1",
    name: "Platform",
    resource_type: "team",
  },
  ...overrides,
});

type PortfolioFixture = z.infer<typeof asanaPortfolioSchema>;
const portfolioFixture = (
  overrides: Partial<PortfolioFixture> = {},
): PortfolioFixture => ({
  gid: "gid-portfolio-1",
  name: "Quarterly Themes",
  resource_type: "portfolio",
  workspace: {
    gid: "gid-workspace-1",
    name: "Engineering",
    resource_type: "workspace",
  },
  ...overrides,
});

type TeamFixture = z.infer<typeof asanaTeamSchema>;
const teamFixture = (overrides: Partial<TeamFixture> = {}): TeamFixture => ({
  gid: "gid-team-1",
  name: "Platform",
  resource_type: "team",
  ...overrides,
});

type UserFixture = z.infer<typeof asanaUserSchema>;
const userFixture = (overrides: Partial<UserFixture> = {}): UserFixture => ({
  gid: "gid-user-1",
  name: "Alex Kim",
  email: "alex@example.com",
  resource_type: "user",
  ...overrides,
});

type SectionFixture = z.infer<typeof asanaSectionSchema>;
const sectionFixture = (
  overrides: Partial<SectionFixture> = {},
): SectionFixture => ({
  gid: "gid-section-1",
  name: "In Progress",
  resource_type: "section",
  project: {
    gid: "gid-project-1",
    name: "Q3 Roadmap",
    resource_type: "project",
  },
  ...overrides,
});

type TaskFixture = z.infer<typeof asanaTaskSchema>;
const taskFixture = (overrides: Partial<TaskFixture> = {}): TaskFixture => ({
  gid: "gid-task-1",
  name: "Implement feature",
  resource_type: "task",
  resource_subtype: "default_task",
  created_at: "2026-07-01T08:00:00Z",
  modified_at: "2026-07-22T08:57:22Z",
  completed_at: null,
  completed: false,
  due_at: "2026-07-31T17:00:00Z",
  due_on: null,
  ...overrides,
});

describe("T023 Asana Zod resource schemas", () => {
  describe("shared primitives (gid, ISO datetime, ISO date)", () => {
    it("gidSchema accepts any non-empty opaque string", () => {
      // FR-017: gid is an opaque string — no numeric / UUID / format
      // assumption. The schema must accept any non-empty string.
      expect(gidSchema.safeParse("1").success).toBe(true);
      expect(gidSchema.safeParse("abc-def-123").success).toBe(true);
      expect(gidSchema.safeParse("1200000").success).toBe(true);
      expect(gidSchema.safeParse("").success).toBe(false);
    });

    it("isoDateTimeSchema accepts a UTC Z timestamp", () => {
      expect(isoDateTimeSchema.safeParse("2026-07-22T08:57:22Z").success).toBe(
        true,
      );
    });

    it("isoDateTimeSchema accepts an offset timestamp (forward-compatible)", () => {
      expect(
        isoDateTimeSchema.safeParse("2026-07-22T08:57:22+02:00").success,
      ).toBe(true);
    });

    it("isoDateTimeSchema rejects a malformed timestamp", () => {
      expect(isoDateTimeSchema.safeParse("2026-07-22").success).toBe(false);
      expect(isoDateTimeSchema.safeParse("2026/07/22T08:00:00Z").success).toBe(
        false,
      );
    });

    it("isoDateSchema accepts YYYY-MM-DD only", () => {
      expect(isoDateSchema.safeParse("2026-07-22").success).toBe(true);
      expect(isoDateSchema.safeParse("2026-07-1").success).toBe(false);
      expect(isoDateSchema.safeParse("2026-07-22T08:00:00Z").success).toBe(
        false,
      );
    });
  });

  describe("pagination (asanaNextPageSchema / asanaListResponseSchema)", () => {
    it("asanaNextPageSchema accepts Asana's wire shape", () => {
      const result = asanaNextPageSchema.safeParse({
        offset: "eyJsYXN0X2dpZCI6MTAwfQ==",
        path: "/workspaces",
      });
      expect(result.success).toBe(true);
    });

    it("asanaNextPageSchema accepts null (final page)", () => {
      expect(asanaNextPageSchema.safeParse(null).success).toBe(true);
    });

    it("asanaListResponseSchema wraps a list with { data, next_page }", () => {
      const schema = asanaListResponseSchema(asanaWorkspaceSchema);
      const result = schema.safeParse({
        data: [workspaceFixture()],
        next_page: null,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data).toHaveLength(1);
        expect(result.data.next_page).toBeNull();
      }
    });

    it("asanaListResponseSchema rejects a missing data array", () => {
      const schema = asanaListResponseSchema(asanaWorkspaceSchema);
      const result = schema.safeParse({ next_page: null });
      expect(result.success).toBe(false);
    });
  });

  describe("compact reference (asanaReferenceSchema)", () => {
    it("accepts gid-only (opt_fields minimal)", () => {
      const result = asanaReferenceSchema.safeParse({ gid: "gid-1" });
      expect(result.success).toBe(true);
    });

    it("accepts gid + name + resource_type", () => {
      const result = asanaReferenceSchema.safeParse({
        gid: "gid-1",
        name: "Engineering",
        resource_type: "workspace",
      });
      expect(result.success).toBe(true);
    });

    it("rejects an empty gid", () => {
      const result = asanaReferenceSchema.safeParse({
        gid: "",
        name: "Engineering",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("custom field shapes (FR-016, FR-081, FR-082)", () => {
    it("asanaCustomFieldEnumOptionSchema accepts an option wire shape", () => {
      const result = asanaCustomFieldEnumOptionSchema.safeParse({
        gid: "gid-opt-high",
        name: "High",
        color: "red",
        enabled: true,
      });
      expect(result.success).toBe(true);
    });

    it("asanaCustomFieldSchema accepts a number field (Estimated Time)", () => {
      const result = asanaCustomFieldSchema.safeParse({
        gid: "gid-cf-est",
        name: "Estimated Time",
        type: "number",
        resource_subtype: "number",
        number_value: 60,
        text_value: null,
        enum_value: null,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.number_value).toBe(60);
      }
    });

    it("asanaCustomFieldSchema accepts an enum field (Priority)", () => {
      const result = asanaCustomFieldSchema.safeParse({
        gid: "gid-cf-pri",
        name: "Priority",
        type: "enum",
        resource_subtype: "enum",
        enum_value: {
          gid: "gid-opt-high",
          name: "High",
          color: "red",
          enabled: true,
        },
        number_value: null,
        text_value: null,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enum_value?.gid).toBe("gid-opt-high");
      }
    });

    it("asanaCustomFieldSchema accepts a null enum_value (no priority set)", () => {
      // FR-081: a missing Priority option is `null`, not a default —
      // the schema must NOT coerce it to "Medium" or any other value.
      const result = asanaCustomFieldSchema.safeParse({
        gid: "gid-cf-pri",
        name: "Priority",
        type: "enum",
        enum_value: null,
        number_value: null,
        text_value: null,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enum_value).toBeNull();
      }
    });

    it("asanaCustomFieldSchema rejects a missing name (required field)", () => {
      const result = asanaCustomFieldSchema.safeParse({
        gid: "gid-cf",
        type: "number",
        number_value: 60,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Workspace (FR-011)", () => {
    it("asanaWorkspaceSchema accepts a real Workspace wire shape", () => {
      const result = asanaWorkspaceSchema.safeParse(workspaceFixture());
      expect(result.success).toBe(true);
    });

    it("asanaWorkspaceSchema accepts is_organization: true (organisation-as-workspace)", () => {
      const result = asanaWorkspaceSchema.safeParse(
        workspaceFixture({ is_organization: true }),
      );
      expect(result.success).toBe(true);
    });

    it("asanaWorkspaceSchema rejects a missing name", () => {
      const result = asanaWorkspaceSchema.safeParse({
        gid: "gid-workspace-1",
        resource_type: "workspace",
      });
      expect(result.success).toBe(false);
    });

    it("asanaWorkspaceSchema rejects a wrong resource_type literal", () => {
      const result = asanaWorkspaceSchema.safeParse({
        gid: "gid-workspace-1",
        name: "Engineering",
        resource_type: "project",
      });
      expect(result.success).toBe(false);
    });

    it("asanaWorkspaceListResponseSchema wraps a workspace list", () => {
      const result = asanaWorkspaceListResponseSchema.safeParse({
        data: [
          workspaceFixture(),
          workspaceFixture({ gid: "gid-workspace-2" }),
        ],
        next_page: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Project (FR-012, FR-016)", () => {
    it("asanaProjectSchema accepts a real Project wire shape", () => {
      const result = asanaProjectSchema.safeParse(projectFixture());
      expect(result.success).toBe(true);
    });

    it("asanaProjectSchema accepts a project with no owning team (synthetic 'No Asana Team')", () => {
      // data-model.md: a project missing an asanaTeamGid is a valid
      // state — the reporting-team resolution falls back to a
      // synthetic bucket rather than dropping the project.
      const result = asanaProjectSchema.safeParse(
        projectFixture({ team: null }),
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.team).toBeNull();
      }
    });

    it("asanaProjectSchema accepts archived: true (FR-012 detection case)", () => {
      const result = asanaProjectSchema.safeParse(
        projectFixture({ archived: true }),
      );
      expect(result.success).toBe(true);
    });

    it("asanaProjectSchema rejects a missing archived flag", () => {
      // archived MUST be a required boolean per FR-012 — Asana's
      // default-field behaviour must not silently start treating a
      // project as not-archived.
      const result = asanaProjectSchema.safeParse({
        gid: "gid-project-1",
        name: "Q3",
        resource_type: "project",
      });
      expect(result.success).toBe(false);
    });

    it("asanaProjectListResponseSchema wraps a project list", () => {
      const result = asanaProjectListResponseSchema.safeParse({
        data: [projectFixture()],
        next_page: { offset: "next", path: "/projects" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Portfolio (FR-016, FR-039)", () => {
    it("asanaPortfolioSchema accepts a real Portfolio wire shape", () => {
      const result = asanaPortfolioSchema.safeParse(portfolioFixture());
      expect(result.success).toBe(true);
    });

    it("asanaPortfolioListResponseSchema wraps a portfolio list", () => {
      const result = asanaPortfolioListResponseSchema.safeParse({
        data: [portfolioFixture()],
        next_page: null,
      });
      expect(result.success).toBe(true);
    });

    it("asanaPortfolioItemSchema accepts a compact project reference", () => {
      const result = asanaPortfolioItemSchema.safeParse({
        gid: "gid-project-1",
        name: "Q3",
        resource_type: "project",
      });
      expect(result.success).toBe(true);
    });

    it("asanaPortfolioItemsResponseSchema wraps portfolio items", () => {
      const result = asanaPortfolioItemsResponseSchema.safeParse({
        data: [{ gid: "gid-project-1", name: "Q3", resource_type: "project" }],
        next_page: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("AsanaTeam (FR-016, FR-041)", () => {
    it("asanaTeamSchema accepts a real Team wire shape", () => {
      const result = asanaTeamSchema.safeParse(teamFixture());
      expect(result.success).toBe(true);
    });

    it("asanaTeamSchema rejects an empty name", () => {
      const result = asanaTeamSchema.safeParse({
        gid: "gid-team-1",
        name: "",
        resource_type: "team",
      });
      expect(result.success).toBe(false);
    });

    it("asanaTeamListResponseSchema wraps a team list", () => {
      const result = asanaTeamListResponseSchema.safeParse({
        data: [teamFixture()],
        next_page: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("User (FR-016)", () => {
    it("asanaUserSchema accepts a user with an email", () => {
      const result = asanaUserSchema.safeParse(userFixture());
      expect(result.success).toBe(true);
    });

    it("asanaUserSchema accepts a user with email: null (no-visibility case)", () => {
      // Per data-model.md: email is nullable, not defaulted to "" —
      // a missing/withheld email must propagate as null.
      const result = asanaUserSchema.safeParse(userFixture({ email: null }));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBeNull();
      }
    });

    it("asanaUserListResponseSchema wraps a user list", () => {
      const result = asanaUserListResponseSchema.safeParse({
        data: [userFixture()],
        next_page: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Section (FR-016)", () => {
    it("asanaSectionSchema accepts a real Section wire shape", () => {
      const result = asanaSectionSchema.safeParse(sectionFixture());
      expect(result.success).toBe(true);
    });

    it("asanaSectionListResponseSchema wraps a section list", () => {
      const result = asanaSectionListResponseSchema.safeParse({
        data: [sectionFixture()],
        next_page: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Task (FR-014, FR-015, FR-016, FR-030)", () => {
    it("asanaTaskSchema accepts a default_task with full opt_fields", () => {
      const result = asanaTaskSchema.safeParse(
        taskFixture({
          assignee: {
            gid: "gid-user-1",
            name: "Alex Kim",
            resource_type: "user",
          },
          projects: [
            {
              gid: "gid-project-1",
              name: "Q3 Roadmap",
              resource_type: "project",
            },
          ],
          parent: null,
          custom_fields: [
            {
              gid: "gid-cf-est",
              name: "Estimated Time",
              type: "number",
              resource_subtype: "number",
              number_value: 90,
              text_value: null,
              enum_value: null,
            },
            {
              gid: "gid-cf-pri",
              name: "Priority",
              type: "enum",
              resource_subtype: "enum",
              enum_value: {
                gid: "gid-opt-high",
                name: "High",
                color: "red",
                enabled: true,
              },
              number_value: null,
              text_value: null,
            },
          ],
          dependencies: [
            {
              gid: "gid-task-2",
              name: "Blocker task",
              resource_type: "task",
            },
          ],
        }),
      );
      expect(result.success).toBe(true);
    });

    it("asanaTaskSchema accepts a subtask (parent reference set)", () => {
      const result = asanaTaskSchema.safeParse(
        taskFixture({
          gid: "gid-subtask-1",
          name: "Subtask",
          parent: {
            gid: "gid-task-1",
            name: "Implement feature",
            resource_type: "task",
          },
        }),
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.parent?.gid).toBe("gid-task-1");
      }
    });

    it("asanaTaskSchema accepts a milestone (FR-015 excluded-from-metrics case)", () => {
      // FR-015: milestones are a real Asana resource_subtype — the
      // schema must accept them at the wire boundary; the in-scope
      // predicate (data-model.md) is what excludes them from metrics.
      const result = asanaTaskSchema.safeParse(
        taskFixture({
          resource_subtype: "milestone",
          name: "Phase 1 complete",
        }),
      );
      expect(result.success).toBe(true);
    });

    it("asanaTaskSchema accepts an approval (FR-015 excluded-from-metrics case)", () => {
      const result = asanaTaskSchema.safeParse(
        taskFixture({
          resource_subtype: "approval",
          name: "Sign-off",
        }),
      );
      expect(result.success).toBe(true);
    });

    it("asanaTaskSchema rejects an unknown resource_subtype (FR-015 guard)", () => {
      // Asana adding a new subtype must be a *visible* validation
      // failure at the boundary, not a silent pass-through that
      // later breaks the in-scope predicate. Cast through `unknown`
      // so the typed fixture builder can't block the negative-case
      // test at `tsc`.
      const result = asanaTaskSchema.safeParse(
        taskFixture({
          resource_subtype:
            "new_subtype" as unknown as TaskFixture["resource_subtype"],
        }),
      );
      expect(result.success).toBe(false);
    });

    it("asanaTaskSchema rejects an unparseable created_at", () => {
      const result = asanaTaskSchema.safeParse(
        taskFixture({ created_at: "not-a-date" }),
      );
      expect(result.success).toBe(false);
    });

    it("asanaTaskSchema rejects a missing modified_at", () => {
      const result = asanaTaskSchema.safeParse({
        gid: "gid-task-1",
        name: "T",
        resource_type: "task",
        resource_subtype: "default_task",
        created_at: "2026-07-01T00:00:00Z",
      });
      expect(result.success).toBe(false);
    });

    it("asanaTaskSchema accepts a date-only due_on with null due_at (FR-030)", () => {
      // FR-030: a date-only due date is normalised to a documented
      // instant under the active timezone at ingestion time. The
      // wire boundary sees both fields nullable; the cache's
      // resolution of "date-only" vs "datetime" is the
      // normalisation layer's responsibility.
      const result = asanaTaskSchema.safeParse(
        taskFixture({ due_at: null, due_on: "2026-07-31" }),
      );
      expect(result.success).toBe(true);
    });

    it("asanaTaskResourceSubtypeSchema enumerates the three FR-015 subtypes", () => {
      // The literal union is the FR-015 contract: drift in this
      // array surfaces as a `tsc` failure rather than a runtime
      // one. In Zod 4 `z.enum(...).options` exposes the literal
      // string values directly (not wrapped option objects).
      const subtypes = asanaTaskResourceSubtypeSchema.options;
      expect(subtypes).toHaveLength(3);
      expect(subtypes).toEqual(["default_task", "milestone", "approval"]);
    });

    it("asanaTaskListResponseSchema wraps a task list", () => {
      const result = asanaTaskListResponseSchema.safeParse({
        data: [taskFixture()],
        next_page: null,
      });
      expect(result.success).toBe(true);
    });

    it("asanaSubtaskListResponseSchema reuses the task-list shape", () => {
      // The subtasks endpoint returns the same wire envelope; the
      // alias exists for call-site readability, so the test asserts
      // structural identity rather than re-parsing the same input.
      const result = asanaSubtaskListResponseSchema.safeParse({
        data: [taskFixture({ parent: { gid: "gid-task-1" } })],
        next_page: null,
      });
      expect(result.success).toBe(true);
    });

    it("asanaTaskDependenciesResponseSchema wraps task-dependencies list", () => {
      const result = asanaTaskDependenciesResponseSchema.safeParse({
        data: [{ gid: "gid-task-2" }, { gid: "gid-task-3" }],
        next_page: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Dependency cache shape (FR-016, US9 blocked-work)", () => {
    it("dependencySchema accepts a fully-populated edge", () => {
      const result = dependencySchema.safeParse({
        taskGid: "gid-task-1",
        dependsOnTaskGid: "gid-task-2",
        dependsOnTaskAccessible: true,
      });
      expect(result.success).toBe(true);
    });

    it("dependencySchema accepts dependsOnTaskAccessible: false (out-of-scope blocker)", () => {
      // data-model.md "Blocked-work definition": an out-of-scope /
      // inaccessible dependency is treated as still-blocking and
      // surfaced as a flag, not silently dropped.
      const result = dependencySchema.safeParse({
        taskGid: "gid-task-1",
        dependsOnTaskGid: "gid-task-2",
        dependsOnTaskAccessible: false,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dependsOnTaskAccessible).toBe(false);
      }
    });

    it("dependencySchema rejects a missing dependsOnTaskAccessible", () => {
      // The accessibility flag MUST be a boolean — silently defaulting
      // it to true would flip a "out of scope, conservatively blocking"
      // edge into an "accessible, blocks" edge.
      const result = dependencySchema.safeParse({
        taskGid: "gid-task-1",
        dependsOnTaskGid: "gid-task-2",
      });
      expect(result.success).toBe(false);
    });

    it("dependencySchema rejects an empty dependsOnTaskGid (FR-017 opaque gid)", () => {
      const result = dependencySchema.safeParse({
        taskGid: "gid-task-1",
        dependsOnTaskGid: "",
        dependsOnTaskAccessible: true,
      });
      expect(result.success).toBe(false);
    });
  });
});
