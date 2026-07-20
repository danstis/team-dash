
# Feature Specification: Asana Team Performance & Workload Dashboard

**Feature Branch**: `001-asana-team-dashboard`

**Created**: 2026-07-20

**Status**: Draft

**Input**: User description (condensed): Build a self-hosted, single-user Progressive Web App that connects read-only to a chosen Asana workspace using a user-supplied personal access token, retrieves all tasks/subtasks across every accessible project, caches the dataset locally in the browser (IndexedDB), and provides transparent, drillable reporting on workload, delivery (work added vs. completed), backlog size/direction, and team-member performance. The dashboard must support composable filtering, grouping, comparison, and drill-down to source tasks; must never silently mask missing data; must correctly deduplicate tasks that belong to multiple projects; must track backlog history via daily local snapshots; and must ship as an early, runnable P1 vertical slice (token setup → workspace connection → refresh → cached status → filters → task table → one work-added-vs-completed chart) before P2 metrics are layered on. The full unabridged product brief supplied by the user is the authoritative source for all requirements below.

## Clarifications

### Session 2026-07-20

- Q: Where do Estimated Time and Actual Time values come from in Asana? → A: Estimated Time is Asana's prebuilt "Estimated Time" custom field; Actual Time comes from Asana's native Time Tracking feature, which is a paid-plan capability.
- Q: Should archived Asana projects be included in the app's data scope (retrieval, backlog, reporting)? → A: Exclude archived projects entirely from retrieval and all reporting.
- Q: Since reconstructed backlog history has no stored point-in-time team mapping, how should past reporting-team groupings be attributed? → A: Always use the current team mapping; reconstructed history is fully dynamic and has no "as originally reported" claim.
- Q: Should the daily-snapshot mechanism be removed and replaced entirely by on-demand reconstruction from cached task dates? → A: Retain snapshots as a performance-cache layer only, derived from task creation/completion/estimate dates as the source of truth, backfilled retroactively on the first refresh rather than accumulated day-by-day.
- Q: How should a task that later leaves scope (deleted, project archived, removed from all in-scope projects) affect previously-shown historical backlog figures? → A: History can shift on a later refresh; the app discloses that history reflects data as currently known from the cache, not an immutable original record.
- Q: What should the default displayed range be for the backlog-over-time view? → A: Reuse the same standard date-range presets already defined for other charts (this week, last 30 days, this month, this quarter, custom).
- Q: Since Asana doesn't expose historical values of the Estimated Time field, should reconstructed backlog-effort-over-time figures use each task's current cached estimate applied retroactively to past dates? → A: Yes, always use the task's latest known estimate for all historical points, disclosed as a known limitation.
- Q: For the encrypted persistent token storage, what should the encryption primarily defend against, and how should the key be managed? → A: Encrypt with a non-extractable Web Crypto API (AES-GCM) key that is itself stored in IndexedDB; the app decrypts automatically on launch with no extra unlock step, preserving today's "persistent = no re-entry" behaviour. This defends against casual/opportunistic access to the raw IndexedDB files (e.g., a copied browser profile) but does not add protection against an attacker who can already execute script in the app's own origin (e.g., XSS), since such a script could use the same key.
- Q: If the stored token can't be decrypted on launch (e.g., the non-extractable key record is missing/corrupted, or IndexedDB data was partially cleared/migrated), how should the app behave? → A: Treat it as if no token were stored — fall back to the first-run credential entry screen and let the user re-enter their token, consistent with existing first-run/empty-state handling, rather than adding a separate dedicated error state.
- Q: When the user switches persistent mode off (back to session-only) or replaces the token, should the old encrypted token record and its key be deleted from IndexedDB immediately? → A: Yes — delete the previous encrypted token value and its associated non-extractable key immediately on mode switch or token replacement, not just when the full clear-data action (FR-007) is run.
- Q: Should ad-hoc/named user groupings for reporting be a new entity distinct from the existing project-based Reporting Team, or should Reporting Team be extended to support direct person membership? → A: New "Person Group" entity, separate from Reporting Team; Reporting Team stays project-based, Person Group membership derives from a task's assignee.
- Q: Where should Person Groups (ad-hoc and named) be usable in reporting? → A: Both as a filter (narrowing to members' tasks) and as a grouping/comparison dimension in charts.
- Q: Should the ad-hoc (quick add/remove) list of users persist across app reloads, or is it session-only UI state? → A: Session-only, consistent with the existing filter/session-persistence assumption; it resets on reload unless explicitly saved as a named Person Group.
- Q: When a person belongs to more than one named Person Group, and charts are grouped by Person Group, should a task attribute to every group its assignee belongs to? → A: Yes, multi-membership — a task counts toward each Person Group its assignee belongs to (mirroring the Reporting Team rule in FR-045), while workspace-level totals remain deduplicated.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect to Asana safely and choose a workspace (Priority: P1)

A team leader opens the dashboard for the first time, enters their Asana personal access token, chooses whether to keep it for this session only or store it persistently (with explicit risk disclosure for the persistent option), and selects which accessible Asana workspace to report on.

**Why this priority**: Nothing else in the product can function without a validated credential and a chosen workspace. This is the mandatory entry point for every other story.

**Independent Test**: Using a mock/deterministic Asana API, enter a token, observe a successful "test token" result, choose session-only mode, select a workspace from the returned list, and land on an empty/first-run dashboard. Fully testable without any other feature existing.

**Acceptance Scenarios**:

1. **Given** no token has been entered, **When** the user opens the app, **Then** the app shows a first-run credential entry screen and blocks access to reporting screens until a valid token and workspace are set.
2. **Given** the user enters a syntactically plausible token, **When** they choose "Test token", **Then** the app calls Asana to validate it and reports success (with the workspaces the token can access) or a specific failure reason (invalid token, network error, insufficient permission).
3. **Given** a token has been validated, **When** the user chooses persistent storage, **Then** the app explains that the token is sensitive, states the storage risk and that it remains on this device/browser profile, and requires an explicit confirmation step before writing it to IndexedDB.
4. **Given** the user does not confirm persistent storage, **When** they dismiss or decline, **Then** the app falls back to session-only mode without storing the token.
5. **Given** a validated token, **When** the user views the list of accessible workspaces, **Then** they can select exactly one workspace to use for reporting, and that choice is what scopes all subsequent data retrieval.
6. **Given** an already-configured session, **When** the user opens Settings, **Then** they can test the current token again, replace it, switch between session-only and persistent storage, or clear the token and all locally retained Asana data in one explicit action.
7. **Given** a token is stored or in use, **When** the user views any screen, log, exported content, or URL, **Then** the full token value is never displayed, logged, or embedded — at most a masked/partial identifier is shown.

---

### User Story 2 - Retrieve and cache workspace data with transparent refresh status (Priority: P1)

The team leader triggers a manual refresh that retrieves tasks, subtasks, projects, portfolios, teams, and users from the selected workspace and stores them in the browser's local cache, while the app clearly shows progress, outcome, and data freshness at every stage.

**Why this priority**: The dashboard has nothing to report until data exists locally, and trust in every downstream metric depends on the user always knowing whether they are looking at fresh or cached data, or a partial/failed result.

**Independent Test**: Against a deterministic mock Asana API (including a large-fixture variant), trigger Refresh and verify progress feedback, a successful completion with a visible "last refreshed" time, that a subsequent app reload shows the same cached data with a "showing cached data" indicator, and that a simulated network failure mid-refresh leaves the previous good cache intact.

**Acceptance Scenarios**:

1. **Given** a validated token and selected workspace with no prior cache, **When** the user presses Refresh, **Then** the app retrieves all in-scope projects, tasks, subtasks, and related entities, shows progress (e.g., items retrieved so far), and on completion shows a success state with the completion timestamp.
2. **Given** a completed refresh exists, **When** the user reopens the app later (including after closing the browser), **Then** the previously cached dataset loads immediately and the UI clearly states it is cached data along with the last successful refresh time.
3. **Given** a refresh is in progress, **When** the network fails, the token becomes invalid, the user lacks permission, Asana returns a rate-limit response, or the user cancels, **Then** the app shows the specific failure/cancellation reason, stops without corrupting existing data, and the previously complete cache (if any) remains fully intact and usable.
4. **Given** a refresh partially completes (e.g., some pages retrieved, then an error), **When** the app finishes handling the error, **Then** the incomplete data is discarded or held separately and is never presented as if it were the new complete cache.
5. **Given** the app has never completed a refresh, **When** the user views the dashboard, **Then** they see a clear first-run/empty state directing them to run a refresh, not a blank or misleading report.
6. **Given** the browser is offline, **When** the user opens the app, **Then** the last cached dashboard is viewable, and the Refresh action is visibly disabled/labelled as unavailable offline with an explanation.
7. **Given** a successful refresh completes, **When** the app finishes, **Then** it captures a reporting snapshot for that browser-local calendar day; a second successful refresh later the same day replaces that day's snapshot rather than adding a duplicate.

---

### User Story 3 - Browse and filter the task list with drill-down (Priority: P1)

The team leader views a table of cached tasks and narrows it using basic filters (date range, assignee, project, completion state) to verify what data is present and confirm the app is retrieving the right work.

**Why this priority**: A visible, filterable, verifiable task list is the trust anchor for every summary metric — users must be able to see the tasks behind any number before they will rely on aggregated reporting.

**Independent Test**: With a cached fixture dataset loaded, open the task table, apply a date-range filter and an assignee filter together, confirm the row count changes accordingly, clear filters, and open a single task to see its full source detail including all project memberships and a link to the task in Asana.

**Acceptance Scenarios**:

1. **Given** cached data is present, **When** the user opens the task table, **Then** it lists tasks with enough fields (name, assignee, project(s), priority, dates, completion state, estimated/actual time) to verify inclusion or exclusion from any metric.
2. **Given** the task table is open, **When** the user applies one or more filters (date range, assignee, project, completion state, etc.), **Then** the table updates to the matching tasks only, and the active filters remain visibly listed.
3. **Given** filters are active, **When** the user clears all filters, **Then** the table returns to the full in-scope task list.
4. **Given** a task belongs to more than one project, **When** the user opens its detail, **Then** all of its project memberships are shown, not just the one used in the current view.
5. **Given** a task row, **When** the user chooses to open it in Asana, **Then** the app opens the correct Asana task URL without exposing the personal access token anywhere in that link or request.
6. **Given** a filter combination matches zero tasks, **When** the table renders, **Then** the app shows an explicit no-results state rather than an empty table with no explanation.

---

### User Story 4 - See work added versus work completed over time (Priority: P1)

The team leader selects a date range and views how many tasks (and how much estimated effort) were created versus completed in that period, broken down over time and optionally grouped by team member, team, project, portfolio, or priority.

**Why this priority**: This is the MVP's primary reporting outcome — the single clearest signal of whether a team or individual is keeping pace with incoming work.

**Independent Test**: Using a fixture dataset with known creation/completion dates and estimates, select "last 30 days," verify the created and completed counts and effort sums match hand-calculated expectations, switch the item-count view to the effort view, group by team member, and drill into one chart point to see the contributing tasks.

**Acceptance Scenarios**:

1. **Given** a selected date range, **When** the chart renders, **Then** it shows, per time bucket, the count of tasks created in that bucket (by creation date) and the count of tasks completed in that bucket (by completion date), each independently.
2. **Given** the same date range, **When** the user switches to the effort view, **Then** the chart shows summed estimated effort for created and completed tasks instead of counts, clearly labelled as a distinct measure from the count view.
3. **Given** the chart is displayed, **When** the user applies a grouping (team member, team, project, portfolio, or priority), **Then** the chart splits into series per group value, including an explicit "unassigned"/"no priority" series where applicable.
4. **Given** a chart point or series, **When** the user drills down, **Then** they see the exact list of contributing tasks, matching the count/sum shown.
5. **Given** a task appears in multiple in-scope projects, **When** it is counted at a project-combination, portfolio, team, or workspace level, **Then** it is counted exactly once.
6. **Given** tasks without an estimate, **When** the effort view is shown, **Then** those tasks are excluded from the effort sum but included in the count view, and the app indicates how many tasks lacked an estimate rather than silently treating them as zero effort without disclosure.

---

### User Story 5 - Track backlog size and direction (Priority: P1)

The team leader views the current incomplete task count and total incomplete estimated effort, and sees whether the backlog is growing, shrinking, or holding steady over time — reconstructed from each in-scope task's creation, estimate, and completion dates — at workspace, team, project, portfolio, or assignee level, starting from the very first refresh.

**Why this priority**: Monitoring whether the backlog is under control is the second MVP-defining outcome. Because history is reconstructed from task dates already present in the cache (not accumulated day-by-day), it depends on the data retrieval established in User Story 2 but does not require multiple refreshes over multiple days before it becomes useful.

**Independent Test**: Using a fixture with a single completed refresh containing tasks with a range of past creation/completion dates, load the backlog view, confirm the current incomplete count/effort matches the latest cache, confirm the trend line reconstructs backlog size across past dates directly from those task dates (no prior day's refresh required), filter to a single project, and confirm the unestimated-backlog figure is shown separately from the estimated total.

**Acceptance Scenarios**:

1. **Given** cached data exists, **When** the user opens the backlog view, **Then** it shows the current count of incomplete tasks and the total estimated effort of incomplete tasks, deduplicated across projects.
2. **Given** a single completed refresh has occurred, **When** the user views the backlog trend, **Then** it plots incomplete count and incomplete effort across past dates reconstructed from in-scope tasks' creation and completion dates, and indicates whether each is trending up, down, or flat, without requiring any prior day's refresh.
3. **Given** the reconstructed history spans a period during which a task later leaves scope (deleted, project archived, or removed from all in-scope projects), **When** the trend is viewed again after that task leaves scope, **Then** the app may show a different historical figure for the affected dates and discloses that history reflects data as currently known from the cache, not an immutable original record.
4. **Given** a backlog view scoped to a team, project, portfolio, or assignee, **When** rendered, **Then** the same deduplication rule applies as workspace-level views, and team/reporting-team groupings on historical points use the currently configured team mapping (not a point-in-time mapping).
5. **Given** incomplete tasks without an estimate, **When** the backlog effort total is shown, **Then** the unestimated portion (count and, where relevant, its exclusion from the effort sum) is displayed as its own figure so it cannot make the backlog look smaller than it is.
6. **Given** the user drills into a backlog figure, **When** the drill-down opens, **Then** it lists exactly the incomplete tasks contributing to that figure.

---

### User Story 6 - Configure reporting team mappings (Priority: P2)

The team leader reviews the Asana-team-owns-project default and optionally overrides it with a local mapping — reassigning a project to a different reporting team or consolidating several Asana teams into one reporting team — so that team-level reporting matches how the organisation actually operates.

**Why this priority**: Useful immediately once team-level grouping is used in P1 charts, but the Asana-derived default is sufficient to ship the P1 slice, so refinement is deferred.

**Independent Test**: With a fixture containing two Asana teams, override one project's reporting team to the other team, confirm team-level charts immediately reflect the override, confirm the UI labels that team as "locally overridden" rather than "from Asana," and confirm the mapping persists after a reload.

**Acceptance Scenarios**:

1. **Given** no override exists for a project, **When** reporting team is shown, **Then** it equals the Asana team that owns the project, labelled as sourced from Asana.
2. **Given** the user sets an override for a project, **When** reporting views render, **Then** they use the overridden reporting team and label it as a local override.
3. **Given** an override is removed, **When** views re-render, **Then** they revert to the Asana-derived default.
4. **Given** the app is reloaded, **When** the user views team mappings, **Then** previously configured overrides persist from local storage.

---

### User Story 7 - Review current assigned workload per person (Priority: P2)

The team leader views, for each team member, their currently assigned incomplete task count and estimated effort, to spot who is overloaded or under-loaded.

**Why this priority**: A natural extension of the backlog view once assignee-level drill-down exists; valuable but not required for the first usable slice.

**Independent Test**: With a fixture of known per-assignee incomplete tasks/estimates, open the workload view and confirm each assignee's count/effort, including an "Unassigned" bucket, matches expectations, then drill into one assignee.

**Acceptance Scenarios**:

1. **Given** cached data, **When** the workload view renders, **Then** each team member shows their current incomplete task count and estimated effort, deduplicated across projects.
2. **Given** incomplete tasks with no assignee, **When** the view renders, **Then** they appear in an explicit "Unassigned" row rather than being dropped.
3. **Given** the user drills into a team member, **When** the detail opens, **Then** it lists exactly their contributing incomplete tasks.

---

### User Story 8 - Analyse completed work, on-time delivery, and priority breakdown (Priority: P2)

The team leader reviews completed task counts/effort over time, overdue counts/effort, on-time completion rate, and completed work broken down by priority.

**Why this priority**: Extends the P1 delivery story with delivery-quality detail once the core added-vs-completed slice is proven.

**Independent Test**: With a fixture including on-time, overdue, and no-due-date tasks, verify overdue figures only include incomplete tasks past their due date, verify the on-time rate's stated denominator excludes tasks without a due date (as documented), and verify priority-grouped completed totals sum to the ungrouped total.

**Acceptance Scenarios**:

1. **Given** a date range, **When** the user views completed work, **Then** completed task count and completed estimated effort are shown per time bucket, deduplicated.
2. **Given** incomplete tasks with a due date in the past, **When** the overdue view renders, **Then** they are counted as overdue by count and estimated effort; completed tasks are never counted as overdue.
3. **Given** the on-time completion rate is shown, **When** the user inspects it, **Then** the app states its denominator (completed tasks with a due date) and explicitly shows, separately, how many completed tasks had no due date and were therefore excluded.
4. **Given** completed tasks are grouped by priority, **When** rendered, **Then** a "No priority" group is shown for tasks missing the field, and the sum of all groups equals the ungrouped completed total for the same period.

---

### User Story 9 - Investigate estimate accuracy, blocked work, and stalled work (Priority: P2)

The team leader compares estimated versus actual time on completed tasks, and reviews which incomplete tasks are blocked by unfinished dependencies or have had no activity for longer than a configurable threshold.

**Why this priority**: High diagnostic value for coaching and process improvement, but depends on estimate/actual and dependency data being reliably modelled, which is lower risk to defer past the MVP slice.

**Independent Test**: With a fixture containing tasks with matching, over-, and under-estimates, and tasks with zero/missing estimates, verify variance calculations and their explicit handling of zero/missing cases; with a fixture containing a task depending on an incomplete task, verify it is flagged blocked; and with a configurable threshold, verify a task with no modification within that threshold is flagged stalled while a recently modified one is not.

**Acceptance Scenarios**:

1. **Given** a completed task with both estimated and actual time, **When** variance is calculated, **Then** the app shows absolute and percentage variance in human-friendly units.
2. **Given** a completed task with a zero or missing estimate, **When** variance is shown, **Then** the app displays it as "not comparable" rather than an infinite or misleading percentage, and excludes it from aggregate variance averages while still counting it in totals.
3. **Given** an incomplete task with at least one incomplete dependency it is waiting on, **When** the blocked-work view renders, **Then** that task is listed as blocked, and the dependency-based definition used is shown to the user.
4. **Given** a user-configurable stalled-work threshold (with a documented default), **When** an incomplete task's last-modified date is older than the threshold, **Then** it is flagged stalled; changing the threshold re-evaluates the flag.

---

### User Story 10 - Review task age, cycle time, and data-quality gaps (Priority: P2)

The team leader reviews the average age of incomplete tasks, the cycle time of completed tasks, and a summary of data-quality gaps (unassigned, unestimated, missing priority, missing due date, missing actual time) so reporting limitations are visible rather than hidden.

**Why this priority**: Rounds out the diagnostic picture; depends on the underlying date and field data already modelled by earlier stories.

**Independent Test**: With a fixture of known task ages and completion spans, verify the average-age figure and the cycle-time figure match hand calculations using the documented start/end definitions, and verify the data-quality panel counts match a manual tally of fixture gaps.

**Acceptance Scenarios**:

1. **Given** incomplete tasks, **When** the average-age view renders, **Then** it shows the mean age (now minus creation date) across the current in-scope incomplete tasks, deduplicated.
2. **Given** completed tasks in a date range, **When** the cycle-time view renders, **Then** it shows the distribution/average of (completion date minus creation date) using that documented definition, visibly labelled.
3. **Given** cached data, **When** the data-quality panel renders, **Then** it shows counts of tasks missing assignee, estimate, priority, due date, and actual time (for completed tasks), each drillable to the specific tasks.

---

### Edge Cases

- A workspace the token can access has zero projects, or the token has zero accessible workspaces: the app must state this rather than showing an empty table with no explanation.
- The token is revoked, expires, or loses permission mid-refresh: the refresh must fail cleanly, report the auth/permission failure, and leave the previous good cache untouched.
- A task's parent project changes, or a task is removed from all in-scope projects between refreshes: the task must not be silently treated as completed; its removal/loss of scope must be determined reliably before it is dropped or marked, and the app must record how it knows.
- A subtask sits under a parent task without inheriting all of the parent's project metadata directly from Asana: the app must still resolve which in-scope project(s) it belongs to consistently, using the parent task's project memberships.
- A task belongs to projects owned by two different Asana teams: team-level totals must not double count it, and its detail view must show both project/team associations.
- The Priority custom field is missing from a project, renamed, or has unexpected option values compared to the expected template: the app must visibly flag this as a data-quality/validation issue rather than treating the task as having no priority silently or crashing.
- A completed task has an actual-time value but no estimate, or an estimate but no actual-time value: estimate-vs-actual views must handle each missing side explicitly rather than defaulting to zero.
- Estimated/actual time is recorded in different underlying units across tasks: displayed values must be normalised to consistent human-friendly units without losing calculation precision.
- The browser's local storage quota is exceeded or IndexedDB write fails during a refresh: the refresh must fail safely without corrupting the existing cache, and the user must be told storage failed.
- A persisted, encrypted token cannot be decrypted on launch (its non-extractable key record is missing, corrupted, or partially cleared/migrated): the app must treat this the same as no token stored and fall back to the first-run credential entry screen, rather than a separate dedicated error state.
- A refresh is interrupted by the browser/tab closing: on next launch, the app must detect the incomplete refresh and recover to the last known-good complete cache rather than showing partial data as current.
- The user's system clock, timezone, or DST offset changes between sessions (or the user switches the local/UTC setting): date-bucketed charts, due-date interpretation, and snapshot-day boundaries must be recalculated consistently under the newly selected timezone, not mixed between old and new bases.
- Two successful refreshes occur on the same local calendar day: only one snapshot is retained for that day (the latest), not two.
- A long-unused browser resumes with expired or invalid incremental-sync state: the app must detect this and fall back to a full reconciliation rather than presenting an unknowingly incomplete dataset as current.
- A filter combination produces a zero denominator for a rate-based metric (e.g., on-time completion rate with no completed tasks having due dates in range): the app must show "not applicable" rather than a divide-by-zero result or a misleading zero.
- A task depends on another task that is outside the in-scope project set (or inaccessible to the token): the app must document and apply a defensible rule for whether that dependency still counts toward "blocked," rather than silently ignoring or silently blocking.
- The user changes a local team-mapping override: because backlog-over-time history is reconstructed from task dates using the currently configured mapping (not a point-in-time mapping), reconstructed team/reporting-team historical views immediately reflect the new mapping on next render; the app must make clear that historical team attribution is not preserved as it was originally reported.
- A task that previously contributed to a reconstructed historical backlog figure later leaves scope (deleted, its project is archived, or it is removed from all in-scope projects): the reconstructed historical figures for dates that task previously contributed to may change on a later refresh once the task is no longer in the cache; the app must disclose that backlog history reflects data as currently known, not an immutable record of what was shown previously.
- The very first refresh completes for a workspace with years of pre-existing task history: the app must reconstruct and display backlog-over-time history immediately from that single refresh's cached task dates, without requiring any subsequent day's refresh to build up a trend.
- The user switches the selected Asana workspace: cached data, snapshot history, and team mappings for the previous workspace must not be silently merged with or overwritten by the new workspace's data.
- A milestone or approval-type Asana item exists in an in-scope project: it must be excluded from reportable work counts and effort sums, consistently.
- A project is archived in Asana (including one archived between refreshes): it and its tasks must be excluded from retrieval and from all reporting, including backlog size/direction and historical snapshot figures; a task that loses in-scope status solely because its only project(s) became archived must be handled per the existing rule for a task losing scope (see the parent-project-change edge case above), not silently treated as completed.
- The dataset is at or near the upper expected scale (~25,000 tasks): filtering, grouping, and chart rendering must remain usable and give progress feedback rather than appearing frozen.

## Requirements *(mandatory)*

### Functional Requirements — Credential & Token Management

- **FR-001**: The system MUST require a user-supplied Asana personal access token before any reporting screen is accessible.
- **FR-002**: The system MUST offer session-only token handling (retained only for the current browser session, requiring re-entry afterward) and persistent token handling (stored encrypted in browser-local IndexedDB per FR-002a), with session-only as the default mode.
- **FR-002a**: When persistent storage is used, the system MUST encrypt the token at rest using a Web Crypto API AES-GCM key that is generated non-extractable and stored alongside it in IndexedDB, so the token cannot be recovered as plaintext by directly reading the browser's storage files (e.g., a copied profile directory) without executing script in the app's own origin; the system MUST decrypt it automatically on launch without requiring a separate unlock step, and MUST disclose that this protects against passive/opportunistic storage access but not against an attacker already able to execute script in the app's own origin (e.g., XSS).
- **FR-002b**: If the persisted token cannot be decrypted on launch (e.g., its non-extractable key record is missing, corrupted, or was only partially cleared/migrated), the system MUST treat this the same as no token being stored and fall back to the first-run credential entry screen, rather than presenting a separate dedicated error state.
- **FR-003**: Before enabling persistent storage, the system MUST present a clear explanation that the token is sensitive, describe the risk of local storage (including the encryption-at-rest approach and its stated limitation per FR-002a), state that it remains on that device/browser profile, and require an explicit confirmation action before writing it to persistent storage.
- **FR-004**: The system MUST let the user test the current token's validity and permissions on demand, showing a specific success or failure outcome.
- **FR-005**: The system MUST let the user replace the stored/session token at any time.
- **FR-005a**: Whenever a persisted token is replaced, or the user switches from persistent mode back to session-only, the system MUST immediately delete the previous encrypted token record and its associated non-extractable key (see FR-002a) from IndexedDB, rather than leaving it in place until the full clear-data action (FR-007) is run.
- **FR-006**: The system MUST let the user switch between session-only and persistent storage modes at any time, applying the confirmation requirement of FR-003 whenever switching into persistent mode.
- **FR-007**: The system MUST provide a single explicit action that clears the token and all locally retained Asana data (cache, snapshots, team mappings) together.
- **FR-008**: The system MUST NOT display the complete token value once entered (at most a masked/partial representation may be shown), and MUST NOT include the token in logs, diagnostics, exported content, or URLs.
- **FR-009**: The system MUST use the token only for read-only Asana API access and MUST NOT create, edit, complete, assign, or delete any Asana resource.
- **FR-010**: Every outbound request made to open a task in Asana or link to Asana content MUST be constructed without embedding the personal access token in the URL or request in a way that could leak it.

### Functional Requirements — Workspace & Data Scope

- **FR-011**: During initial setup, the system MUST let the user choose one Asana workspace from those accessible to the validated token, and MUST scope all data retrieval and reporting to that chosen workspace.
- **FR-012**: The system MUST retrieve reporting data for every active (non-archived) project accessible to the token within the chosen workspace, and MUST exclude archived projects and their tasks from retrieval and from all reporting, including backlog and historical snapshot figures.
- **FR-013**: The system MUST exclude personal/"My Tasks" items that are not associated with an in-scope project.
- **FR-014**: The system MUST include standard tasks and their subtasks, and MUST resolve a subtask's in-scope project membership consistently even when Asana does not repeat parent-project metadata directly on the subtask record.
- **FR-015**: The system MUST exclude milestones and approval-type items from all reportable work counts, effort sums, and other metrics.
- **FR-016**: The system MUST retrieve and retain the workspace, projects, portfolios, Asana teams, project-to-team ownership, sections (where used for status-like reporting), users/assignees, task project memberships, and dependency information needed for blocked-work reporting.
- **FR-017**: The system MUST treat Asana `gid` values as opaque strings for identity, comparison, and storage, without assuming a numeric size, UUID, or GUID format.
- **FR-018**: The system MUST remain correct and usable for a workspace containing at least 25,000 in-scope tasks.

### Functional Requirements — Local Cache, Refresh & Snapshot History

- **FR-019**: The system MUST persist the latest successfully retrieved dataset in browser-local IndexedDB so the dashboard remains usable across sessions without requiring a new refresh.
- **FR-020**: The system MUST provide a prominent, explicit manual Refresh action; the system MUST NOT perform scheduled or background refreshes without user action.
- **FR-021**: During a refresh, the system MUST show progress, and on completion MUST show the outcome (success, partial failure, cancellation, authentication failure, permission failure, or rate-limit failure) along with the last successful refresh timestamp and whether currently displayed data is cached or fresh.
- **FR-022**: A failed, cancelled, or incomplete refresh MUST NOT replace a previously complete cache with partial data; the last known-good complete cache MUST remain the data shown until a new refresh completes successfully.
- **FR-023**: The system MUST upsert cached records by Asana `gid`, and MUST only remove or mark a record as deleted/out-of-scope/inaccessible when that condition can be determined reliably; a record that merely fails to appear in a given retrieval MUST NOT be silently interpreted as completed.
- **FR-024**: The system MUST prefer incremental/delta retrieval when it can be done validly per Asana's documented capabilities, and MUST detect when incremental state is stale, invalid, or insufficient and fall back to a full reconciliation that restores correctness without corrupting the existing cache during the fallback.
- **FR-025**: Retrieval optimisation (including any date-range narrowing or incremental/delta retrieval) MUST NOT exclude older incomplete tasks, nor completed tasks regardless of how long ago they were completed, that are needed to reconstruct current or historical backlog figures from task creation/completion dates.
- **FR-026**: The system MUST reconstruct backlog-over-time history (incomplete count and incomplete estimated effort at each past date) directly from each in-scope task's creation date, completion date (if any), and current cached estimate — without requiring data from a previous day's refresh — so that a full historical trend is available immediately after the first successful refresh.
- **FR-026a**: On each successful refresh, the system MUST derive and store a daily snapshot as a performance cache of the reconstructed backlog-over-time figures, for use in rendering the trend without recomputing from raw task data every time; a second successful refresh on the same calendar day MUST replace that day's cached snapshot rather than creating an additional one. This cache is a derived optimisation only — the task dates in the local cache remain the source of truth.
- **FR-026b**: On the first successful refresh (and whenever the cached snapshot layer is stale, missing, or invalid), the system MUST backfill the daily snapshot cache retroactively for all past dates derivable from currently cached task data, rather than only beginning accumulation from that day forward.
- **FR-027**: The system MUST retain the derived daily snapshot cache indefinitely unless the user performs the explicit clear-data action in FR-007; the cache MAY be recomputed/backfilled again at any time from current task data without data loss, since it is not the source of truth.
- **FR-028**: When a task that previously contributed to reconstructed backlog-history figures later leaves scope (deleted, its project becomes archived, or it is removed from all in-scope projects), the system MUST allow previously displayed historical figures for dates that task contributed to to change on a later refresh, and MUST visibly disclose that backlog history reflects data as currently known from the cache rather than an immutable record of what was originally shown.

### Functional Requirements — Time & Date Behaviour

- **FR-029**: The system MUST default all reporting to the browser's local timezone and MUST offer a setting to switch to UTC.
- **FR-030**: The system MUST apply the selected timezone consistently to chart time buckets, reporting-period boundaries, due-date interpretation, snapshot-day boundaries, and displayed timestamps.
- **FR-031**: The system MUST treat weeks as starting on Monday wherever a weekly bucket or "this/last week" preset is used.
- **FR-032**: The system MUST offer date-range presets including at least this week, last week, last 30 days, this month, last month, and this quarter, plus a custom start/end range.
- **FR-033**: For every metric, the system MUST make its date basis explicit in the UI (e.g., work added uses creation date, work completed uses completion date, current backlog is a point-in-time state rather than an "updated within range" count).
- **FR-034**: Changing the local/UTC timezone setting MUST cause date-bucketed charts and range boundaries to be recalculated consistently under the newly selected basis rather than mixing bases.

### Functional Requirements — Multi-Project Deduplication

- **FR-035**: In a single-project view, the system MUST show every task belonging to that project, regardless of its membership in other projects.
- **FR-036**: At any grouping or total above a single project (combined-project views, portfolios, teams, assignees, or workspace totals), the system MUST count each task exactly once by its `gid`.
- **FR-037**: When a user drills from an aggregate figure into task detail, the system MUST show all of that task's project memberships.
- **FR-038**: The deduplication rule in FR-036 MUST be applied consistently to task counts, effort totals, time variance figures, overdue counts/effort, completion counts/effort, and backlog trend figures.
- **FR-039**: The system MUST apply the same deduplication rule to portfolio-level totals, using each portfolio's contained projects.
- **FR-040**: The system MUST apply the same deduplication rule to reporting-team-level totals, using the effective reporting team of each of a task's projects (see Team Model requirements).

### Functional Requirements — Team Model

- **FR-041**: The system MUST default a project's reporting team to the Asana team that owns that project.
- **FR-042**: The system MUST provide a browser-local configurable mapping that lets the user assign a project to a different reporting team, consolidate multiple Asana teams into one reporting team, or otherwise override the default.
- **FR-043**: Wherever a reporting team is displayed, the system MUST indicate whether it is the Asana-derived default or a local override.
- **FR-044**: Team mapping overrides MUST persist in browser-local IndexedDB across sessions.
- **FR-045**: A task belonging to projects mapped to more than one reporting team MUST be attributed to reporting-team-level totals for each applicable reporting team in a way that keeps single-team totals correct, while workspace-level totals remain deduplicated per FR-036.
- **FR-046**: Historical/backlog-over-time trend views grouped or filtered by reporting team MUST use the currently configured team mapping applied retroactively to all historical points (reconstructed history has no stored point-in-time mapping); the system MUST clearly indicate to the user that historical team attribution reflects the current mapping, not the mapping that may have been in effect on each historical date.
- **FR-042a**: The system MUST let the user build an ad-hoc, session-only list of individual people ("Person Group") by quickly adding and removing members, for use in reporting without requiring the group to be named or saved.
- **FR-042b**: The system MUST let the user save an ad-hoc list as a persisted, named Person Group (or create one directly), and rename, edit membership of, or delete named Person Groups at any time; named Person Groups MUST persist in browser-local IndexedDB across sessions, scoped to the current workspace.
- **FR-042c**: An ad-hoc Person Group MUST NOT persist across app reloads; it resets to empty on reload unless the user has explicitly saved it as a named Person Group before reloading, consistent with other session-scoped filter/grouping state.
- **FR-042d**: Person Groups (ad-hoc or named) MUST be selectable both as a filter (narrowing the visible task set to members' tasks) and as a grouping/comparison dimension in charts and tables, wherever assignee- or team-based grouping is offered.
- **FR-042e**: When a task's assignee is a member of more than one named Person Group, and reporting is grouped by Person Group, the task MUST be attributed to each such group's per-group totals (mirroring the multi-team attribution rule in FR-045), while workspace-level and other ungrouped totals remain deduplicated per FR-036.

### Functional Requirements — Filtering, Grouping, Comparison & Drill-down

- **FR-047**: The system MUST support composable filtering by date range, assignee (including an explicit "unassigned" option), reporting team, Asana team, Person Group (ad-hoc or named, per FR-042a/FR-042b), project, portfolio, priority (including an explicit "missing priority" option), completion state, overdue/on-time state, estimated/unestimated state, and blocked/stalled state where those metrics are present.
- **FR-048**: The system MUST let the user combine multiple filters simultaneously, clear all filters in one action, and see the currently active filters listed at all times.
- **FR-049**: Wherever a filter changes the denominator used by a displayed metric (e.g., restricting to estimated tasks only), the system MUST make that denominator change visible to the user.
- **FR-050**: The system MUST support grouping and comparison across at least team member, team, Person Group, project, portfolio, priority, completion state, and time bucket.
- **FR-051**: The system MUST support individual drill-down, side-by-side comparison of multiple groups, ranked tables, and leaderboards, each user-selectable, without reducing results to a single unexplained composite score.
- **FR-052**: Every summary card, chart series, table row, and ranked result MUST support drill-down to its contributing tasks wherever that is practical for the metric.
- **FR-053**: The task detail view/table reached via drill-down MUST show sufficient source fields (project memberships, dates, assignee, priority, completion state, estimate/actual, dependencies) for the user to verify why a task was included in, or excluded from, the metric they drilled from.
- **FR-054**: Each task detail MUST provide a link to the corresponding task in Asana that does not expose the personal access token.
- **FR-055**: Ranked/leaderboard views that compare individuals MUST expose the underlying calculation and relevant data-completeness context (e.g., how many of a person's tasks are unestimated) alongside the ranking.

### Functional Requirements — P1 Metric: Work Added vs. Work Completed

- **FR-056**: The system MUST count tasks created within the selected date range, using each task's creation date, deduplicated across projects.
- **FR-057**: The system MUST count tasks completed within the selected date range, using each task's completion date, deduplicated across projects.
- **FR-058**: The system MUST sum estimated effort for tasks created within the range and, separately, for tasks completed within the range, excluding tasks without an estimate from the sum while disclosing how many were excluded.
- **FR-059**: The system MUST chart created and completed measures over time buckets appropriate to the selected range (e.g., daily, weekly).
- **FR-060**: The system MUST let the user group/filter this metric by team member, team, project, portfolio, and priority wherever the underlying data supports the grouping meaningfully.
- **FR-061**: The system MUST clearly distinguish the item-count view from the estimated-effort view and MUST NOT combine them into a single blended number.
- **FR-062**: The system MUST make each created/completed figure drillable to its exact contributing task list.

### Functional Requirements — P1 Metric: Backlog Size & Direction

- **FR-063**: The system MUST show the current count of incomplete tasks and the current total estimated effort of incomplete tasks, deduplicated across projects, as a point-in-time state rather than an activity-in-range count.
- **FR-064**: The system MUST reconstruct and show whether incomplete count and incomplete effort are growing, shrinking, or stable over time using history derived from in-scope tasks' creation/completion dates, available immediately from the first successful refresh (using standard date-range presets per FR-032 to scope the displayed period, per FR-026), without requiring multiple days of refreshes.
- **FR-065**: The system MUST support workspace, reporting-team, Asana-team, project, portfolio, and assignee views of backlog size and direction, applying the deduplication rules consistently, with reporting-team views on historical points always using the current team mapping (see FR-046).
- **FR-066**: The system MUST show unestimated incomplete-task count separately from the estimated incomplete-effort total so that missing estimates cannot make the backlog appear smaller than it is; historical effort figures MUST use each task's current cached estimate applied retroactively to past dates it was incomplete, and the system MUST disclose this as a known limitation since Asana does not expose historical estimate values.
- **FR-067**: The system MUST make each backlog figure drillable to its exact contributing incomplete-task list, including historical points where the drill-down reflects tasks currently known to have been incomplete on that date.
- **FR-068**: The derived daily snapshot cache MUST NOT be skipped or corrupted by a partial/failed refresh; only a successful refresh produces, replaces, or backfills the cache (see FR-022, FR-026a, FR-026b). A failed or partial refresh MUST NOT prevent the reconstructed history from reflecting the last known-good complete cache.

### Functional Requirements — P2 Metrics

- **FR-069**: The system MUST show current assigned workload (incomplete task count and estimated effort) per team member, including an explicit "Unassigned" grouping, deduplicated across projects, drillable to contributing tasks.
- **FR-070**: The system MUST show completed task count and completed estimated effort over time, using completion date, deduplicated, with the same grouping/filtering support as the work-added-vs-completed metric.
- **FR-071**: The system MUST show estimated-vs-actual time variance for completed tasks, in both absolute and percentage terms, explicitly marking tasks with a zero or missing estimate or actual value as "not comparable" rather than computing a misleading ratio, and excluding those tasks from averaged variance while still reflecting them in totals/counts.
- **FR-072**: The system MUST show overdue task count and overdue estimated effort, defined as incomplete tasks whose due date/time has passed under the selected timezone, deduplicated.
- **FR-073**: The system MUST show an on-time completion rate whose denominator is completed tasks that had a due date, explicitly stating that denominator and separately showing the count of completed tasks with no due date that were excluded.
- **FR-074**: The system MUST show completed work broken down by priority, including a "No priority" group, deduplicated, summing to the same total as the ungrouped completed figure for the same period.
- **FR-075**: The system MUST show blocked work as incomplete tasks with at least one incomplete dependency they are waiting on, using a documented definition displayed to the user, deduplicated.
- **FR-076**: The system MUST show stalled work as incomplete tasks whose last-modified date exceeds a documented, user-configurable inactivity threshold, with a stated default, deduplicated.
- **FR-077**: The system MUST show the average age of incomplete tasks (current date minus creation date), deduplicated.
- **FR-078**: The system MUST show cycle time for completed tasks (completion date minus creation date, per the documented definition shown to the user), deduplicated.
- **FR-079**: The system MUST show data-quality indicator counts for tasks missing assignee, estimate, priority, due date, or (for completed tasks) actual time, each drillable to the specific affected tasks.
- **FR-080**: Every P2 metric MUST document, and make visible to the user, its population, date basis, numerator, denominator, treatment of missing values, deduplication rule, unit, and drill-down behaviour, consistent with the P1 metrics.

### Functional Requirements — Data Validation & Quality Signalling

- **FR-081**: The system MUST validate that the expected Priority custom field and its templated options are present and well-formed for in-scope projects, and MUST visibly flag missing or malformed Priority field data rather than treating it as an absent value with no explanation.
- **FR-082**: The system MUST visibly flag other structurally missing or malformed expected fields (e.g., an unreadable estimate/actual duration value) rather than silently treating them as zero.
- **FR-083**: The system MUST never convert a missing or malformed value into a favourable state (e.g., treating a missing due date as "on time," or a missing completion date as "not completed" without basis).
- **FR-084**: The system MUST provide a visible summary of data-completeness issues discovered during the most recent refresh (e.g., counts of tasks with missing/malformed Priority) so the user can judge how much to trust affected metrics.

### Functional Requirements — Dashboard Experience & States

- **FR-085**: The system MUST provide deliberately designed loading, empty, first-run, no-results, stale-cache, offline, invalid-token, insufficient-permission, rate-limited, and partial-data states, each with a clear explanation and, where applicable, a next action.
- **FR-086**: The system MUST preserve and continue showing the last complete dashboard while a new refresh is in progress, rather than blanking the screen.
- **FR-087**: As an installable Progressive Web App, the system MUST allow the cached dashboard and locally stored snapshot history to be viewed while offline, and MUST clearly state that refresh is unavailable offline.
- **FR-088**: The system MUST support keyboard operation of core workflows, provide programmatic labels for interactive elements, maintain readable contrast, avoid colour-only distinctions in charts, and provide tabular/textual alternatives to visualisations.
- **FR-089**: The system MUST remain usable on desktop as the primary target while remaining operable on tablet and narrow-screen viewports.
- **FR-090**: The system MUST label every dashboard view with the currently selected timezone basis, active filters, and last successful refresh time, updating consistently as those change.

### Non-Functional Requirements

- **NFR-001 (Performance)**: The system MUST remain responsive when filtering, grouping, and rendering cached reporting across a workspace of up to 25,000 in-scope tasks.
- **NFR-002 (Refresh feedback at scale)**: The system MUST provide continuous, meaningful progress feedback throughout a refresh of a workspace containing up to 25,000 tasks, without appearing to hang.
- **NFR-003 (Local-first privacy)**: All Asana data, settings, credentials, team mappings, and reporting history MUST remain in the user's browser; the system MUST NOT introduce a shared server-side reporting database in the MVP.
- **NFR-004 (Read-only integrity)**: The system MUST make no Asana API call capable of creating, editing, completing, assigning, or deleting a resource.
- **NFR-005 (Testability without live credentials)**: Every user story MUST be independently demonstrable and automatically testable using deterministic fixtures or mocks, without requiring a real personal access token or live Asana workspace.
- **NFR-006 (Deployment)**: The system MUST be runnable both via a local development server and as a self-hosted Docker container.
- **NFR-007 (Resilience)**: The system MUST recover safely from expired/invalid incremental-sync state, storage-quota failures, and interrupted refreshes without corrupting previously cached, complete data.
- **NFR-008 (Australian English)**: User-facing text and documentation MUST use Australian English spelling and conventions.

## Metric Definitions *(mandatory)*

Each metric below states: Population · Date field · Numerator/measure · Denominator · Missing-value treatment · Deduplication · Units · Drill-down.

### P1 — Work Added

- **Population**: In-scope tasks (standard tasks and subtasks; excludes milestones/approvals) whose creation date falls in the selected range.
- **Date field**: Task creation date.
- **Measure**: Count of tasks; separately, sum of estimated effort.
- **Denominator**: N/A (count/sum metric, not a rate).
- **Missing values**: Tasks without an estimate are excluded from the effort sum but included in the count; the number excluded is disclosed.
- **Deduplication**: One count/sum per task `gid` at any grouping above single-project.
- **Units**: Task count; estimated effort in human-friendly duration units (e.g., hours), retaining precision internally.
- **Drill-down**: Exact contributing task list.

### P1 — Work Completed

- **Population**: In-scope tasks whose completion date falls in the selected range.
- **Date field**: Task completion date.
- **Measure**: Count of tasks; separately, sum of estimated effort.
- **Denominator**: N/A.
- **Missing values**: Tasks without an estimate excluded from effort sum, count disclosed.
- **Deduplication**: Per task `gid`.
- **Units**: Task count; duration units for effort.
- **Drill-down**: Exact contributing task list.

### P1 — Backlog Size

- **Population**: In-scope tasks that are currently incomplete (point-in-time, not range-based).
- **Date field**: None (state, not a range measure); the historical trend (see P1 — Backlog Direction) uses the reconstructed date for each past point, not a snapshot-capture date.
- **Measure**: Count of incomplete tasks; total estimated effort of incomplete tasks; unestimated incomplete count shown separately.
- **Denominator**: N/A.
- **Missing values**: Unestimated tasks counted in the incomplete-task count but excluded from the estimated-effort total; shown as a distinct figure.
- **Deduplication**: Per task `gid`.
- **Units**: Task count; duration units for effort.
- **Drill-down**: Exact contributing incomplete-task list.

### P1 — Backlog Direction

- **Population**: Historical daily backlog-size measures reconstructed from in-scope tasks' creation and completion dates (a task counts toward a given past date's backlog if it was created on or before that date and not yet completed as of that date); the derived daily snapshot cache serves as a performance layer over this reconstruction, backfilled from the first refresh onward.
- **Date field**: The reconstructed calendar date being evaluated (local calendar day).
- **Measure**: Trend (up/down/flat) of incomplete count and incomplete effort across reconstructed daily points, over the selected date-range preset (per FR-032).
- **Denominator**: N/A.
- **Missing values**: Available immediately from the first successful refresh; no minimum number of refreshes is required. Historical effort uses each task's current cached estimate applied retroactively (see FR-066), and reporting-team grouping on historical points uses the current team mapping (see FR-046) — both disclosed as known limitations.
- **Deduplication**: Per task `gid`, evaluated independently at each reconstructed date.
- **Units**: Directional indicator plus the underlying count/effort series.
- **Drill-down**: Each point drills to the incomplete-task list currently known to have applied on that date; this list can change on a later refresh if a contributing task subsequently leaves scope (see FR-028).

### P2 — Current Assigned Workload

- **Population**: Currently incomplete in-scope tasks, grouped by assignee (including "Unassigned").
- **Date field**: None (state measure).
- **Measure**: Count and estimated effort per assignee.
- **Denominator**: N/A.
- **Missing values**: Unestimated tasks counted, excluded from effort sum, disclosed.
- **Deduplication**: Per task `gid` within each assignee grouping; a task with multiple assignees is not applicable (Asana tasks have a single assignee).
- **Units**: Task count; duration units.
- **Drill-down**: Per-assignee contributing task list.

### P2 — Completed Over Time

Same definition as P1 Work Completed, retained as its own view for time-series-only analysis without the "added" comparison.

### P2 — Estimated vs. Actual Time Variance

- **Population**: Completed in-scope tasks.
- **Date field**: Completion date (for range scoping).
- **Measure**: (Actual − Estimated) absolute and percentage variance, per task and averaged per group.
- **Denominator**: For percentage variance, the task's estimated value; tasks with zero/missing estimate or missing actual are marked "not comparable" and excluded from averaged variance (still counted in totals).
- **Missing values**: Explicit "not comparable" state, never a computed ratio against zero.
- **Deduplication**: Per task `gid`.
- **Units**: Duration units (absolute), percentage (relative).
- **Drill-down**: Contributing task list with per-task estimate/actual/variance.

### P2 — Overdue Work

- **Population**: Currently incomplete in-scope tasks with a due date/time in the past (evaluated under the selected timezone).
- **Date field**: Due date/time.
- **Measure**: Count and estimated effort.
- **Denominator**: N/A.
- **Missing values**: Tasks without a due date are excluded from "overdue" entirely (not overdue, not on-time) and are visible separately as "no due date."
- **Deduplication**: Per task `gid`.
- **Units**: Task count; duration units.
- **Drill-down**: Contributing overdue-task list.

### P2 — On-Time Completion Rate

- **Population**: Completed in-scope tasks within the selected range that had a due date.
- **Date field**: Completion date (range scoping); due date (on-time test).
- **Numerator**: Completed tasks whose completion date/time was at or before their due date/time.
- **Denominator**: Completed tasks in range that had a due date.
- **Missing values**: Completed tasks without a due date are excluded from numerator and denominator and shown separately as an excluded count.
- **Deduplication**: Per task `gid`.
- **Units**: Percentage, with the raw numerator/denominator shown alongside.
- **Drill-down**: On-time and late task lists separately.

### P2 — Completed Work by Priority

- **Population**: Completed in-scope tasks within the selected range.
- **Date field**: Completion date.
- **Measure**: Count/effort per priority option, including "No priority."
- **Denominator**: N/A (breakdown, not a rate).
- **Missing values**: "No priority" is its own explicit group.
- **Deduplication**: Per task `gid` within each priority group.
- **Units**: Task count; duration units.
- **Drill-down**: Per-priority contributing task list.

### P2 — Blocked Work

- **Population**: Currently incomplete in-scope tasks.
- **Date field**: None (state measure).
- **Measure**: Count/effort of tasks with at least one incomplete dependency they are waiting on.
- **Denominator**: N/A.
- **Missing values**: A dependency pointing to a task outside the token's access or out-of-scope is treated as unresolved/blocking, and this treatment is disclosed to the user.
- **Deduplication**: Per task `gid`.
- **Units**: Task count; duration units.
- **Drill-down**: Contributing blocked-task list, each showing which dependency is blocking it.

### P2 — Stalled Work

- **Population**: Currently incomplete in-scope tasks.
- **Date field**: Last-modified date.
- **Measure**: Count/effort of tasks whose last-modified date is older than the configurable threshold (default: 14 days).
- **Denominator**: N/A.
- **Missing values**: N/A (all tasks carry a last-modified date).
- **Deduplication**: Per task `gid`.
- **Units**: Task count; duration units; threshold in days.
- **Drill-down**: Contributing stalled-task list with each task's days-since-modified.

### P2 — Average Age of Incomplete Tasks

- **Population**: Currently incomplete in-scope tasks.
- **Date field**: Creation date.
- **Measure**: Mean (now − creation date).
- **Denominator**: Count of currently incomplete in-scope tasks.
- **Missing values**: N/A.
- **Deduplication**: Per task `gid`.
- **Units**: Days (human-friendly), retaining precision internally.
- **Drill-down**: Contributing incomplete-task list with individual ages.

### P2 — Cycle Time

- **Population**: Completed in-scope tasks within the selected range.
- **Date field**: Completion date (range scoping); creation date and completion date (calculation).
- **Measure**: Distribution/average of (completion date − creation date).
- **Denominator**: Count of completed tasks in range.
- **Missing values**: N/A (both dates required by definition of "completed").
- **Deduplication**: Per task `gid`.
- **Units**: Days (human-friendly), retaining precision internally.
- **Drill-down**: Contributing completed-task list with individual cycle times.

### P2 — Data-Quality Indicators

- **Population**: All in-scope tasks (or the currently filtered set).
- **Date field**: N/A.
- **Measure**: Counts of tasks missing assignee, estimate, priority, due date, or (for completed tasks) actual time.
- **Denominator**: In-scope task count (or currently filtered count) for each indicator's rate, where shown as a percentage.
- **Missing values**: This metric *is* the missing-value report; each indicator is itself a "missing" count.
- **Deduplication**: Per task `gid`.
- **Units**: Task count and, optionally, percentage of population.
- **Drill-down**: Per-indicator contributing task list.

## Key Entities *(include if feature involves data)*

- **Workspace**: The single Asana workspace chosen for reporting; scopes all retrieval and reporting.
- **Project**: An active (non-archived) Asana project within the workspace; owned by an Asana team; may belong to one or more portfolios; contains tasks. Archived projects are out of scope entirely (see FR-012).
- **Portfolio**: A collection of projects; used for portfolio-level grouping and totals.
- **Asana Team**: The team that owns one or more projects in Asana; the default source of "reporting team."
- **Reporting Team**: The effective team used for grouping/comparison — either the Asana team (default) or a locally configured override.
- **Team Mapping Override**: A browser-local record associating a project (or Asana team) with a chosen reporting team; persisted in IndexedDB.
- **Person Group**: A user-defined set of individual people, independent of project ownership, used to quickly filter and group reporting by an arbitrary set of assignees. Exists in two forms: an ad-hoc, session-only list built by adding/removing members (not persisted across reloads), and a named Person Group saved to browser-local IndexedDB (scoped to the current workspace) that persists across sessions and can be renamed, edited, or deleted. A task belongs to a Person Group via its assignee; a task whose assignee is in multiple named Person Groups attributes to each group's totals (see FR-042e), while workspace-level totals remain deduplicated per FR-036.
- **Task**: A unit of reportable work; has a `gid`, name, assignee, project memberships, dates (created/modified/completed/start/due), completion state, estimated time (Asana's "Estimated Time" custom field), actual time (from Asana's native Time Tracking feature, where enabled), priority, dependencies, and an optional parent task.
- **Subtask**: A task with a parent task; inherits in-scope project membership from its parent for reporting purposes.
- **User/Assignee**: An Asana workspace member who may be assigned to tasks; "Unassigned" is a valid explicit state, not an omission.
- **Priority (custom field)**: A templated custom field with a fixed set of options, expected to be present and well-formed on in-scope tasks/projects; validated on refresh.
- **Dependency**: A documented relationship between tasks used to determine blocked status.
- **Section**: A status-like grouping within a project, used where relevant to reporting.
- **Snapshot**: A derived, performance-cache record of reconstructed backlog state for a single browser-local calendar day, produced or replaced only by a successful refresh. Snapshots are not the source of truth — they are recomputed/backfilled from in-scope tasks' creation/completion dates and current estimates in the Local Cache, and MAY change on a later refresh if the underlying task data changes (e.g., a task leaves scope). Reporting-team attribution shown on a snapshot always reflects the current team mapping, not a mapping frozen at capture time.
- **Refresh Session**: The transient process of retrieving data from Asana into the local cache, with a definite outcome (success/partial-failure/cancelled/auth-failure/permission-failure/rate-limited).
- **Credential (Token) Record**: The user's Asana personal access token and its storage mode (session-only or persistent); never displayed in full after entry. When persisted, it is stored encrypted at rest under a non-extractable Web Crypto API key held alongside it in IndexedDB (see FR-002a).
- **Local Cache**: The persisted, upserted-by-`gid` collection of workspace/project/portfolio/team/task/user/dependency data backing all reporting.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user can go from opening the app to seeing their first populated dashboard (token entered, workspace selected, initial refresh complete) in under 10 minutes for a workspace of typical current size (~5,000 tasks), without external help.
- **SC-002**: On a returning visit with an existing cache, the dashboard displays previously retrieved data within 2 seconds of app launch, clearly marked as cached, before any network activity completes.
- **SC-003**: Applying or changing a filter or grouping against a cached dataset of up to 25,000 tasks updates the visible results within 1 second.
- **SC-004**: A full refresh of a 25,000-task workspace completes and shows a definitive success or failure outcome, with progress feedback visible throughout, without the interface appearing unresponsive at any point.
- **SC-005**: In a controlled fixture where correct results are known in advance, 100% of P1 metric figures (work added/completed counts and effort, backlog count/effort/direction) match the expected values, including correct one-time counting of tasks that belong to multiple projects.
- **SC-006**: A failed, cancelled, or interrupted refresh never results in the dashboard showing fewer tasks, a smaller backlog, or different totals than the last complete refresh, verified across at least three interruption scenarios (network failure, auth failure, user cancellation).
- **SC-007**: With no network connection, a user with a prior successful refresh can view the full cached dashboard, including backlog trend history, and is clearly told that refresh is unavailable, in 100% of tested offline scenarios.
- **SC-008**: Every summary figure and chart series tested (100% of P1 metrics, and each P2 metric once implemented) supports drilling down to a task list whose count/sum matches the summary figure exactly.
- **SC-009**: Core dashboard workflows (credential entry, refresh, filtering, grouping, drill-down) are fully operable using only a keyboard, and all chart distinctions remain interpretable without colour, verified through accessibility testing.
- **SC-010**: In testing with malformed or missing Priority-field data injected into fixtures, the app visibly flags the affected tasks in 100% of cases rather than silently treating them as zero/absent priority.
- **SC-011**: Automated tests covering metric calculation, date-boundary/timezone handling, multi-project deduplication, subtask handling, and refresh atomicity pass without requiring a live Asana workspace or real personal access token.

## Assumptions

- **Short name**: This feature is internally referred to as "Asana Team Dashboard" / "001-asana-team-dashboard"; no external product name was specified.
- **Session-only token semantics**: "Session-only" means the token is retained only in memory or browser session storage for the lifetime of the current browser tab/session and is cleared when that session ends (e.g., tab/browser closed); it is not written to any persistent store.
- **Snapshot scope**: Local snapshot cache, cached task data, and team mappings are scoped to the currently selected workspace; switching the selected workspace does not merge or overwrite another workspace's history (a workspace switch is treated as effectively starting fresh local history for that workspace, without deleting data already captured for other workspaces).
- **Historical team attribution**: Because backlog-over-time history is reconstructed from task dates rather than accumulated from immutable point-in-time snapshots, reporting-team attribution on historical points always reflects the currently configured team mapping, not the mapping that may have been in effect on that historical date; this is disclosed to the user (see FR-046).
- **Historical backlog reconstruction, not accumulation**: Backlog-over-time history is derived directly from each in-scope task's creation date, completion date (if any), and current cached estimate — not from data captured on previous refreshes. A full historical trend is available from the very first successful refresh. The daily snapshot cache is a performance optimisation over this reconstruction, not an independent source of truth, and is backfilled retroactively rather than accumulated day-by-day.
- **Historical figures can shift with the cache**: Because reconstruction always uses the currently cached task data, a task that later leaves scope (deleted, its project archived, or removed from all in-scope projects) can change previously displayed historical backlog figures on a later refresh; the app discloses that history reflects data as currently known, not an immutable record of what was shown previously.
- **Historical estimate values**: Asana does not expose historical values of the Estimated Time field, so reconstructed historical effort figures use each task's current cached estimate applied retroactively to every past date it was incomplete; this is disclosed as a known limitation rather than treated as historically precise.
- **Stalled-work default threshold**: The default inactivity threshold for "stalled" is 14 days of no modification, adjustable by the user; this default is a starting point, not a fixed product requirement.
- **Cycle-time definition**: Cycle time is defined as completion date minus creation date; this simple definition is used because in-progress/status transition timestamps are not uniformly available across all projects' sections.
- **Blocked-work definition**: A task is "blocked" if it has at least one Asana dependency ("waiting on") that is itself incomplete; a dependency referencing an inaccessible or out-of-scope task is conservatively treated as still blocking, and this is disclosed.
- **"Test token" behaviour**: Testing a token performs a live, read-only call against the Asana API (e.g., fetching the current token's identity and accessible workspaces) rather than only checking the token's format.
- **Filter/session persistence**: Active filter and grouping selections, including the ad-hoc Person Group list, are session UI state and are not required to persist across app reloads; only credentials, cache, snapshots, team mappings, and named Person Groups persist per the stated requirements.
- **Human-friendly duration units**: Estimated/actual time is displayed in units such as hours and minutes (derived from Asana's underlying duration fields) while full precision is retained for calculations; exact display granularity is left to implementation/planning.
- **Estimated/Actual time source**: Estimated Time is sourced from Asana's prebuilt "Estimated Time" custom field, validated for presence/well-formedness the same way as Priority (FR-081/FR-082). Actual Time is sourced from Asana's native Time Tracking feature, which is only available on paid Asana plan tiers; where Time Tracking is not enabled for the workspace, Actual Time is treated as consistently unavailable data (surfaced via the data-quality indicators, FR-079) rather than zero, and estimate-vs-actual variance (FR-071) treats every task as "not comparable" for that workspace until Time Tracking data becomes available.
- **Deployment access control**: Network-level or host-level access control for the self-hosted deployment (e.g., who can reach the running container) is the operator's responsibility and is out of scope for the application itself, consistent with the single-trusted-user MVP model.
- **Browser/platform baseline**: The PWA targets evergreen desktop browsers with IndexedDB and Service Worker support as its primary baseline; legacy browser support is not assumed.

## Dependencies

- Availability and correctness of the Asana API for workspaces, projects, portfolios, teams, tasks, subtasks, dependencies, and custom fields (Priority, Estimated Time).
- Availability of Asana's native Time Tracking feature (a paid-plan capability) for Actual Time data; on a workspace/plan without Time Tracking enabled, Actual Time MUST be treated as consistently unavailable/missing (per FR-082/FR-083), never as zero.
- A valid, sufficiently permissioned Asana personal access token supplied by the user for real-world (non-test) use.
- The Priority custom field being consistently applied via an Asana template across in-scope projects, as stated in the product brief; the application depends on this consistency to make Priority-based reporting meaningful, while still handling and flagging deviations.
- Browser support for IndexedDB (local persistence), Service Workers (offline/PWA), and standard web platform APIs.
- A container runtime (for self-hosted Docker deployment) or a local development server runtime, provided by the operator.
- Deterministic Asana API fixtures/mocks for automated testing, since CI must never depend on a live workspace or real token.

## Out of Scope (MVP)

- Multi-user authentication, application login, role-based access, or shared/collaborative dashboards.
- OAuth or service-account based Asana connections.
- Any server-side reporting database or shared server-side state.
- Scheduled or background server-side refresh; refresh is manual and user-initiated only.
- Any capability that writes to, edits, completes, assigns, or deletes Asana resources.
- FTE or capacity normalisation of workload figures.
- Notifications or alerts of any kind.
- Export or import of cached data, snapshots, settings, or reports.
- Long-term snapshot pruning, retention limits, or archival controls.
- Custom dashboard builders or arbitrary user-authored formulas/metrics.
- Full coverage of every metric in the metric catalogue within the first implementation slice; P2 metrics are added incrementally after the P1 vertical slice is demonstrable.
- Reporting on milestones or approval-type Asana items as work items.
- Reconstructing historical states for tasks that were deleted from Asana, or for periods before Asana's own creation-date records exist for a task; reconstruction is bounded by what the currently cached task data can derive, not by when snapshots were captured (see FR-026, FR-028).
