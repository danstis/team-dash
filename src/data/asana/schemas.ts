/**
 * Asana Zod resource schemas — T023.
 *
 * This module is the runtime validation boundary for every Asana API
 * response shape the app consumes (`contracts/asana-client.md`).
 * The base HTTP client (`src/data/asana/client.ts`, T025) parses every
 * successful response through one of these schemas before returning
 * `ok` — a mismatch surfaces as a `validation_error` outcome with
 * structured `ZodIssue`s (FR-081 / FR-082 / FR-083), which the
 * refresh orchestrator routes into the `DataQualityFlag` / priority-
 * field status machinery rather than coercing silently.
 *
 * The schemas deliberately accept every field Asana documents on the
 * resource (not just the ones the cache consumes). The cache-level
 * normalisation — collapsing snake_case fields to camelCase,
 * resolving subtask project membership from the parent (FR-014),
 * expanding compact references into the cache's denormalised shape —
 * happens once, at ingestion time, in `src/data/asana/normalise.ts`
 * (T058). This module's contract is *validate the wire shape*; it is
 * not a duplicate of the storage schema.
 *
 * What the schemas intentionally do NOT do:
 *
 * - **No write-method exposure.** Per `contracts/asana-client.md`
 *   "Read-only guarantee" and NFR-004, the Asana client is read-only
 *   by construction. Schemas for create / update / delete payloads
 *   are deliberately absent so a future regression cannot start
 *   smuggling a write method into the client through this module.
 *
 * - **No defaulting of missing fields.** A missing `estimatedMinutes`
 *   is `null`, a missing `due_at` is `null`, a missing priority
 *   enum option is `null`. The cache-level distinction between
 *   `null` (tracked, missing) and the literal `'unavailable'`
 *   (workspace without Time Tracking) is recorded in
 *   `data-model.md` and applied during normalisation, not here.
 *
 * - **No normalisation of `gid`.** Per FR-017, `gid` is an opaque
 *   string. The schemas validate "non-empty string" only; they do
 *   not parse, compare numerically, or assume any format.
 *
 * `src/data/asana/**` is the network-acquisition boundary the spec
 * draws (plan.md: Technical Context, data/asana row). It is allowed
 * to import `react`/the DOM only via downstream code (the client
 * surfaces parsed shapes to `domain/` and `features/`); this module
 * itself has zero `react`/`features`/`domain` imports.
 */

import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Shared primitive schemas                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The opaque-string contract for every `gid` field (FR-017).
 * Asana documents `gid` as a globally unique string; the schemas
 * enforce only "non-empty" so a malformed numeric-looking or empty
 * value is rejected at the validation boundary rather than silently
 * propagating into dedup / upsert paths.
 */
export const gidSchema = z.string().min(1);

/**
 * ISO-8601 instant with an optional offset (e.g. `2026-07-22T08:57:22Z`
 * or `2026-07-22T08:57:22+02:00`). Asana documents its `*_at` fields
 * as UTC `Z`, but accepting offsets is future-proof against an
 * Asana-side change without invalidating the cache.
 */
export const isoDateTimeSchema = z.string().datetime({ offset: true });

/**
 * ISO-8601 calendar date in `YYYY-MM-DD` form (no time component),
 * as Asana returns for `due_on` and the Events API's date-based
 * filters.
 */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/* -------------------------------------------------------------------------- */
/* Pagination shape                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Asana's offset-pagination token (the `next_page` field on every
 * list response). The base HTTP client (T025) passes the `offset`
 * through verbatim to the next request's `?offset=...` query string;
 * the `path` is informational and not currently consumed.
 *
 * Documented as nullable because Asana returns `next_page: null`
 * (not `undefined` / an absent field) on the final page of a
 * paginated list — the validation boundary accepts both
 * representations explicitly to match that wire shape.
 */
export const asanaNextPageSchema = z
  .object({
    offset: z.string().min(1),
    path: z.string().min(1),
  })
  .nullable();

/**
 * The generic `{ data, next_page }` envelope Asana returns for every
 * list endpoint. Used by `client.ts` (T025) as the wrapper around any
 * resource-array parser; the wrapper is exposed as a function so each
 * resource schema composes its own concrete list schema without
 * duplicating the pagination shape.
 */
export const asanaListResponseSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    data: z.array(item),
    next_page: asanaNextPageSchema,
  });

/* -------------------------------------------------------------------------- */
/* Compact reference shapes                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The compact `{ gid, name?, resource_type? }` shape Asana returns
 * for nested object references (e.g. `assignee`, `parent`, `team`,
 * `workspace`, `projects[]`). `name` and `resource_type` are
 * optional because Asana's `opt_fields` selection can suppress them;
 * the `gid` is the only field a call site can rely on being present.
 *
 * Callers MUST treat these as opaque references — the cache holds the
 * full row; a reference here is just enough to display in a drill-down
 * "Open in Asana" link or to resolve a foreign key locally.
 */
export const asanaReferenceSchema = z.object({
  gid: gidSchema,
  name: z.string().optional(),
  resource_type: z.string().optional(),
});

/* -------------------------------------------------------------------------- */
/* Custom field shapes (FR-016, FR-081, FR-082)                                */
/* -------------------------------------------------------------------------- */

/**
 * A single option in a custom-field enum (used for `Priority`'s
 * `High`/`Medium`/`Low`/`None` set). The `gid` is the option's
 * stable identifier; `name` is the human label. `color` and
 * `enabled` are display metadata Asana may return when the
 * custom field's settings were loaded.
 */
export const asanaCustomFieldEnumOptionSchema = z.object({
  gid: gidSchema,
  name: z.string().optional(),
  color: z.string().optional(),
  enabled: z.boolean().optional(),
});

/**
 * The polymorphic custom-field value attached to a task. Asana's
 * custom field "type" determines which value field is populated
 * (`text_value` for text fields, `number_value` for number fields
 * such as "Estimated Time", `enum_value` for enum fields such as
 * "Priority"); other value fields are `null` for that type.
 *
 * The schemas do NOT narrow on `type` here — `type` is `string`
 * rather than a literal union because Asana documents
 * `resource_subtype` variants separately and the wire shape is
 * permissive. Per-field narrowing (e.g. "Estimated Time is a number
 * custom field with a numeric `number_value`") is the normalisation
 * layer's responsibility (T058), not the wire-validation layer's.
 */
export const asanaCustomFieldSchema = z.object({
  gid: gidSchema,
  name: z.string(),
  type: z.string(),
  resource_subtype: z.string().optional(),
  text_value: z.string().nullable().optional(),
  number_value: z.number().nullable().optional(),
  enum_value: asanaCustomFieldEnumOptionSchema.nullable().optional(),
});

/* -------------------------------------------------------------------------- */
/* Resource: Workspace (FR-011)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Workspace resource (`GET /workspaces`, `GET /workspaces/{gid}`).
 * `is_organization` is the legacy alias Asana exposes for the
 * workspace-vs-organisation distinction; the app treats both as a
 * valid workspace scope.
 */
export const asanaWorkspaceSchema = z.object({
  gid: gidSchema,
  name: z.string().min(1),
  resource_type: z.literal("workspace"),
  is_organization: z.boolean().optional(),
});

export const asanaWorkspaceListResponseSchema =
  asanaListResponseSchema(asanaWorkspaceSchema);

/* -------------------------------------------------------------------------- */
/* Resource: Project (FR-012, FR-016)                                          */
/* -------------------------------------------------------------------------- */

/**
 * Project resource (`GET /projects`, `GET /projects/{gid}`).
 *
 * - `archived: boolean` is required: per FR-012, archived projects
 *   are excluded at the retrieval layer entirely, and the field is
 *   also re-validated per-item because Asana may return
 *   recently-archived items in edge cases.
 * - `workspace` is the parent workspace reference; the cache stores
 *   its `gid` as `workspaceGid`.
 * - `team` is nullable: a project may have no owning Asana team
 *   (data-model.md: "falls back to a synthetic 'No Asana Team'
 *   reporting-team bucket").
 * - `custom_field_settings` is the project's list of configured
 *   custom fields; the schemas accept it as `unknown[]` because
 *   each entry's shape varies by field type. Per-field validation
 *   belongs to `PriorityField` normalisation (T058 / T084).
 */
export const asanaProjectSchema = z.object({
  gid: gidSchema,
  name: z.string().min(1),
  resource_type: z.literal("project"),
  archived: z.boolean(),
  workspace: asanaReferenceSchema.optional(),
  team: asanaReferenceSchema.nullable().optional(),
  custom_field_settings: z.array(z.unknown()).optional(),
});

export const asanaProjectListResponseSchema =
  asanaListResponseSchema(asanaProjectSchema);

/* -------------------------------------------------------------------------- */
/* Resource: Portfolio (FR-016, FR-039)                                        */
/* -------------------------------------------------------------------------- */

/**
 * Portfolio resource (`GET /portfolios`, `GET /portfolios/{gid}`).
 * `workspace` is required because every portfolio belongs to a
 * workspace; the cache stores its `gid` as `workspaceGid` indirectly
 * (the cache holds `projectGids[]`, the workspace mapping is
 * recovered via the projects).
 */
export const asanaPortfolioSchema = z.object({
  gid: gidSchema,
  name: z.string().min(1),
  resource_type: z.literal("portfolio"),
  workspace: asanaReferenceSchema.optional(),
});

export const asanaPortfolioListResponseSchema =
  asanaListResponseSchema(asanaPortfolioSchema);

/**
 * Item reference returned by `GET /portfolios/{gid}/items`. Per
 * Asana docs the items endpoint returns compact project
 * references; modelled here as the generic `asanaReferenceSchema`
 * because the wire shape is the same gid/name/resource_type
 * envelope.
 */
export const asanaPortfolioItemSchema = asanaReferenceSchema;

export const asanaPortfolioItemsResponseSchema = asanaListResponseSchema(
  asanaPortfolioItemSchema,
);

/* -------------------------------------------------------------------------- */
/* Resource: AsanaTeam (FR-016, FR-041)                                        */
/* -------------------------------------------------------------------------- */

/**
 * Asana team resource (`GET /teams?workspace={gid}`, or
 * `GET /organizations/{gid}/teams`). The default reporting-team
 * source per FR-041 is the `team` on a project, but explicit team
 * listing supports management/UI flows and is also enumerated by
 * FR-016 as required for in-scope caching.
 */
export const asanaTeamSchema = z.object({
  gid: gidSchema,
  name: z.string().min(1),
  resource_type: z.literal("team"),
});

export const asanaTeamListResponseSchema =
  asanaListResponseSchema(asanaTeamSchema);

/* -------------------------------------------------------------------------- */
/* Resource: User (FR-016)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * User resource (`GET /users/{gid}`, `GET /users?workspace={gid}`,
 * `GET /workspace_memberships`). `email` is nullable because Asana
 * may return `null` for users in workspaces where the token's
 * visibility does not include the email; the cache stores
 * `email: null` to flag that a later refresh may still surface it
 * rather than coercing to an empty string.
 */
export const asanaUserSchema = z.object({
  gid: gidSchema,
  name: z.string().min(1),
  email: z.string().nullable().optional(),
  resource_type: z.literal("user"),
});

export const asanaUserListResponseSchema =
  asanaListResponseSchema(asanaUserSchema);

/* -------------------------------------------------------------------------- */
/* Resource: Section (FR-016)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Section resource (`GET /projects/{gid}/sections`). Sections are
 * project-scoped groupings Asana exposes for status-like reporting
 * (FR-016); the cache stores `projectGid` directly so the project
 * membership lookup stays one query.
 */
export const asanaSectionSchema = z.object({
  gid: gidSchema,
  name: z.string().min(1),
  resource_type: z.literal("section"),
  project: asanaReferenceSchema.optional(),
});

export const asanaSectionListResponseSchema =
  asanaListResponseSchema(asanaSectionSchema);

/* -------------------------------------------------------------------------- */
/* Resource: Task (FR-014, FR-015, FR-016, FR-030)                            */
/* -------------------------------------------------------------------------- */

/**
 * Task `resource_subtype` literal union. Per FR-015, milestones
 * (`milestone`) and approvals (`approval`) are excluded from
 * reportable metrics. `default_task` covers both standard tasks and
 * subtasks — the in-scope predicate distinguishes them via
 * `parentTaskGid` (data-model.md).
 */
export const asanaTaskResourceSubtypeSchema = z.enum([
  "default_task",
  "milestone",
  "approval",
]);

/**
 * Task resource (`GET /projects/{gid}/tasks`,
 * `GET /tasks/{gid}`, `GET /tasks/{gid}/subtasks`).
 *
 * Notable fields:
 *
 * - `resource_subtype` is required and constrained to the three
 *   Asana-documented values; an unexpected value is a
 *   `validation_error` so the FR-015 "exclude milestones/approvals"
 *   rule cannot be silently broken by an Asana-side rename.
 *
 * - `assignee`, `parent`, `projects[]`, `dependencies[]` are all
 *   compact `asanaReferenceSchema`s — full row hydration happens
 *   at the cache layer, not at the validation boundary.
 *
 * - `completed` and `completed_at` are both optional because Asana
 *   may surface either depending on `opt_fields`; the cache
 *   normalises to `completedAt: string | null` (T058).
 *
 * - `due_at` is a full ISO datetime; `due_on` is the date-only
 *   `YYYY-MM-DD` form Asana uses when no time-of-day is set
 *   (FR-030). The cache normalises both to a single instant under
 *   the active timezone.
 */
export const asanaTaskSchema = z.object({
  gid: gidSchema,
  name: z.string().min(1),
  resource_type: z.literal("task"),
  resource_subtype: asanaTaskResourceSubtypeSchema,
  assignee: asanaReferenceSchema.nullable().optional(),
  projects: z.array(asanaReferenceSchema).optional(),
  parent: asanaReferenceSchema.nullable().optional(),
  created_at: isoDateTimeSchema,
  modified_at: isoDateTimeSchema,
  completed_at: isoDateTimeSchema.nullable().optional(),
  completed: z.boolean().optional(),
  due_at: isoDateTimeSchema.nullable().optional(),
  due_on: isoDateSchema.nullable().optional(),
  custom_fields: z.array(asanaCustomFieldSchema).optional(),
  dependencies: z.array(asanaReferenceSchema).optional(),
  notes: z.string().optional(),
});

export const asanaTaskListResponseSchema =
  asanaListResponseSchema(asanaTaskSchema);

/**
 * Subtask response shape. Asana's `GET /tasks/{gid}/subtasks`
 * endpoint returns the same wire shape as the regular tasks
 * endpoint; the schema is aliased here so a caller can be explicit
 * about the subtask-list contract at the type level without
 * duplicating the underlying parser.
 */
export const asanaSubtaskListResponseSchema = asanaTaskListResponseSchema;

/**
 * Dependencies list response shape. `GET /tasks/{gid}/dependencies`
 * returns the same envelope as any list endpoint; the alias keeps
 * the call site readable.
 */
export const asanaTaskDependenciesResponseSchema =
  asanaListResponseSchema(asanaReferenceSchema);

/* -------------------------------------------------------------------------- */
/* Cache-normalised: Dependency (FR-016, US9)                                  */
/* -------------------------------------------------------------------------- */

/**
 * The cache-level `Dependency` shape (data-model.md: "Dependency"
 * cache entity, US9 blocked-work). NOT a raw Asana API resource —
 * Asana has no `/dependencies` resource; the cache normalises the
 * `GET /tasks/{gid}/dependencies` response into one row per
 * dependency edge, recording whether the depended-on task is
 * accessible to the token.
 *
 * Fields:
 *
 * - `taskGid` — the task that is *waiting* on the dependency.
 * - `dependsOnTaskGid` — the task being waited on ("blocked by").
 * - `dependsOnTaskAccessible` — `false` when the target task is
 *   outside the token's access or out of scope; treated as
 *   still-blocking per the documented conservative rule
 *   (data-model.md: "Blocked-work definition").
 */
export const dependencySchema = z.object({
  taskGid: gidSchema,
  dependsOnTaskGid: gidSchema,
  dependsOnTaskAccessible: z.boolean(),
});
