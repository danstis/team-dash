<!--
Sync Impact Report
==================
Version change: N/A (template) → 1.0.0
Modified principles: N/A — initial ratification
Added sections:
  - Core Principles I–VIII (Runnable Vertical Slices and Early Validation;
    Reporting Correctness, Transparency, and Traceability; Test-First Quality
    and Mandatory Automation; Local-First Privacy and Credential Safety; Data
    Integrity and Resilient Synchronisation; Simplicity, Maintainability, and
    Explicit Architecture; Accessible, Honest, and Responsive User Experience;
    Reproducibility, Documentation, and Operational Readiness)
  - Compliance Checklist
  - Governance and Enforcement
Removed sections:
  - Generic [SECTION_2_NAME] / [SECTION_3_NAME] template slots (superseded by
    the eight numbered principles above; no residual generic content required)
Templates requiring updates:
  - .specify/templates/plan-template.md ✅ reviewed — generic "Constitution
    Check" gate references this file directly, no edits required
  - .specify/templates/spec-template.md ✅ reviewed — no principle-specific
    references, no edits required
  - .specify/templates/tasks-template.md ✅ reviewed — no principle-specific
    references, no edits required
  - .specify/templates/checklist-template.md ✅ reviewed — generic, no edits
    required
  - README.md ⚠ pending — currently a one-line stub; Principle VIII requires
    it to describe product boundary, prerequisites, PAT risks, local dev,
    testing, Docker deployment, browser-storage implications, offline
    limitations, data-clearing steps, and troubleshooting. Deferred to the
    implementation phase that establishes the repository foundation (out of
    scope for this constitution-only change).
Follow-up TODOs: none — all placeholders resolved with concrete values.
-->

# Team Dash Constitution

Team Dash is a self-hosted, local-first Asana team performance dashboard.

## Core Principles

### I. Runnable Vertical Slices and Early Validation

The product MUST be delivered as small, independently demonstrable vertical
slices, and the application MUST remain runnable after every completed
delivery task. The repository foundation, automated CI quality gates, local
development workflow, production build, and Docker execution MUST be
established before substantial dashboard functionality is added. The first
product slice MUST connect the minimum end-to-end path: application shell,
safe credential entry, an Asana connection or deterministic mock, local
persistence, cached-data status, basic task visibility, filtering, and one
useful dashboard metric. New metrics and visualisations MUST be introduced
incrementally and MUST NOT be bundled into a single large, untestable
dashboard release. A task is not complete merely because code exists — its
behaviour MUST be executable and verified through the documented local or
container workflow before the task is marked done.

**Rationale**: Long-running, unverified branches hide integration risk and
defer discovery of broken assumptions. Slicing vertically and keeping the
app runnable at every step keeps risk visible and feedback continuous.

### II. Reporting Correctness, Transparency, and Traceability

Reporting correctness MUST take precedence over visual polish or delivery
speed when the two conflict. Every metric MUST document its population,
date basis, numerator, denominator, units, missing-value treatment,
deduplication rule, timezone behaviour, and drill-down path before it is
considered complete. Metric calculations MUST be deterministic, isolated
from presentation code, and testable against fixed synthetic datasets.
Aggregated results MUST be traceable to their contributing source records,
and the interface MUST let an authorised user understand why a given task
was included in or excluded from a metric. Missing or malformed data MUST
NOT be silently converted to zero, success, completion, or any other
favourable state. Rules for multi-project tasks, subtasks, incomplete work,
unestimated work, due dates, and time durations MUST be explicit and
covered by tests. Hidden or unexplained composite performance scores MUST
NOT be created; any ranking or comparison MUST expose its calculation and
relevant data-quality context. A change to a metric definition is a product
behaviour change and requires an updated specification, updated tests, and
a user-facing explanation wherever that metric is displayed.

**Rationale**: This is a performance-reporting tool used to inform
judgements about people and teams. Silent inaccuracy or unexplained scoring
causes real harm; correctness and explainability are non-negotiable.

### III. Test-First Quality and Mandatory Automation

Automated tests MUST be written before or alongside behaviour-changing
implementation, following Red/Green/Refactor: a test MUST fail for the
intended reason before implementation proceeds, MUST pass before
refactoring begins, and refactoring MUST NOT change observed behaviour —
applied wherever practical. CI is a required delivery gate from the
foundation stage onward and MUST validate formatting, linting, strict
TypeScript checks, unit tests, metric and data-contract tests, the
production build, PWA/service-worker behaviour, the Docker build, and a
browser-based smoke test. Security, dependency, and secret scanning MUST
run through appropriate GitHub-native automation. All automated tests MUST
use deterministic synthetic fixtures, generated scale datasets, or mocks;
CI MUST NEVER require a live Asana workspace or a real personal access
token. Any bug in metric logic, deduplication, dates, persistence, refresh
integrity, or credential handling requires an accompanying regression test.
Tests MUST cover both success paths and meaningful failure/recovery paths,
including empty data, missing values, expired sync state, rate limits,
offline use, partial retrieval, and corrupted or outdated local storage. A
change MUST NOT merge while a required quality gate is failing. Flaky tests
MUST be fixed or explicitly quarantined with a tracked remediation; they
MUST NOT be casually retried until green.

**Rationale**: Test-first discipline and a comprehensive, deterministic CI
gate are what make the correctness guarantees in Principle II verifiable
rather than aspirational, and what let a self-hosted, credential-sensitive
tool be changed safely without a live Asana account.

### IV. Local-First Privacy and Credential Safety

The application is local-first: Asana data, reporting history, user
settings, team mappings, sync state, and credentials MUST remain
browser-owned unless a future accepted specification explicitly changes
that boundary. The Asana personal access token is a high-value secret;
session-only handling MUST be the default, and persistent browser storage
MAY be offered only with clear risk disclosure and explicit user
confirmation. Tokens MUST NEVER appear in URLs, logs, error reports,
analytics, source control, fixtures, screenshots, build artefacts,
service-worker caches, or exported reporting data. Clear-data and
credential-removal behaviour MUST be complete, understandable, and tested.
The application MUST request and use no more Asana access than necessary
and MUST remain read-only; any future capability that writes to Asana
requires a separate specification and explicit review of the trust
boundary. Authenticated API responses MUST NOT be accidentally retained by
HTTP caches or service workers outside the intended IndexedDB data model.
Dependencies, rendered Asana content, browser storage, and error handling
MUST be designed to reduce XSS, credential exposure, supply-chain, and
data-leakage risk. No telemetry or external analytics may be introduced
without an explicit specification and an opt-in privacy review.

**Rationale**: Team performance data and Asana tokens are sensitive by
nature. A local-first, read-only, minimal-retention design is the simplest
boundary that avoids building an operator into an unwanted trust position.

### V. Data Integrity and Resilient Synchronisation

The last complete, known-good local dataset MUST remain available until a
newer refresh has completed and passed integrity checks. Refreshes MUST be
atomic from the user's perspective: failed, cancelled, rate-limited,
unauthorised, or partial refreshes MUST NOT replace a complete cache with
incomplete data. Delta or event-based synchronisation MAY be used to
improve efficiency but MUST NOT be treated as infallible — expired state,
missed events, inconsistent counts, or uncertain scope MUST trigger a safe
reconciliation path. Asana resource `gid` values MUST be treated as opaque
strings and used consistently for identity, upserts, memberships, and
deduplication. Deleted, inaccessible, or removed records MUST NOT be
silently interpreted as completed work. IndexedDB schema migrations MUST be
versioned, tested, and recoverable where practical, and MUST NOT silently
discard credentials, cached reporting data, or history. Retrieval
optimisation MUST preserve semantic correctness; in particular, date-range
filtering MUST NOT exclude older incomplete work needed for backlog
baselines. Refresh and recovery behaviour MUST respect official Asana API
pagination and rate-limit guidance and MUST provide useful progress and
error states.

**Rationale**: A dashboard that quietly serves stale, partial, or corrupted
data is worse than one that is honest about its limitations. Atomicity and
safe reconciliation protect both correctness (Principle II) and user trust.

### VI. Simplicity, Maintainability, and Explicit Architecture

The simplest architecture that satisfies the accepted specification and the
local-first privacy boundary MUST be preferred. The codebase MUST use
strict TypeScript and maintain clear boundaries between Asana acquisition,
normalisation, persistence, metric calculation, filtering/grouping, and
presentation. Business and metric logic MUST NOT depend on chart
components, browser rendering, or a live API. Dependencies MUST be
minimised, and each material dependency MUST have a clear purpose, active
maintenance, compatible licensing, and an acceptable security posture. A
server-side database, persistent credential service, distributed system,
generic plugin framework, or premature abstraction MUST NOT be introduced
without an accepted requirement. Significant architectural decisions and
departures from established patterns require a short decision record
describing context, choice, alternatives, and consequences. Readable,
conventional code MUST be preferred over cleverness; public modules,
complex algorithms, metric rules, storage schemas, and non-obvious
trade-offs require useful documentation. Generated code is held to the same
review, testing, security, and maintainability standards as human-written
code.

**Rationale**: A single self-hosted, browser-resident application does not
need server-side or distributed-system complexity. Clear module boundaries
keep metric logic testable in isolation, as required by Principle II.

### VII. Accessible, Honest, and Responsive User Experience

Accessibility is part of correctness. Core workflows MUST support keyboard
use, programmatic labels, focus management, readable contrast, non-colour-
only meaning, and tabular or textual alternatives to charts. The interface
MUST state the last successful refresh, selected timezone, active filters,
date basis, cached/offline status, and material data-quality gaps wherever
they affect interpretation. Loading, empty, stale, offline, no-results,
invalid-token, insufficient-permission, rate-limit, partial-data, and
recovery states MUST be deliberately designed and tested rather than
treated as incidental errors. Cached information MUST NEVER be presented as
current when the application cannot refresh it. The application MUST remain
responsive at the agreed scale of up to 25,000 tasks; performance budgets
for cached startup, filtering, grouping, chart updates, and refresh
feedback MUST be defined in the plan and verified with generated datasets.
The application SHOULD optimise for desktop dashboard use while keeping
core workflows usable at narrower widths. Visualisations MUST clarify the
data rather than decorate it; detailed tables and drill-down remain
first-class capabilities.

**Rationale**: Users make decisions from what the dashboard shows. Honest
status signalling and defined performance budgets prevent the interface
from misrepresenting data freshness or becoming unusable at real scale.

### VIII. Reproducibility, Documentation, and Operational Readiness

A new contributor MUST be able to clone the repository, install
dependencies, run the development server, execute tests, build the PWA, and
start the production Docker image using documented commands. Lockfiles and
reproducible build inputs MUST be committed, and development and CI runtime
versions MUST be declared and kept aligned. Configuration MUST be explicit
and validated; secrets MUST NEVER be committed, and example configuration
MUST contain safe placeholders only. The README MUST describe the product
boundary, prerequisites, PAT risks, local development, testing, Docker
deployment, browser-storage implications, offline limitations, data-
clearing steps, and troubleshooting. Dependency updates and storage-schema
changes require proportionate verification and release notes when they
affect users. Releases MUST identify schema or cache compatibility impacts
and provide a safe recovery path.

**Rationale**: A self-hosted tool lives or dies by how easily an operator
can build, run, upgrade, and recover it without support from the original
authors.

## Compliance Checklist

Plans, pull requests, and releases MUST work through this checklist and
record the outcome for every applicable item:

- [ ] Change is a small, independently demonstrable vertical slice; the
      application remains runnable after it lands (Principle I)
- [ ] New or changed metrics document population, date basis, numerator,
      denominator, units, missing-value treatment, deduplication rule,
      timezone behaviour, and drill-down path (Principle II)
- [ ] No hidden composite score introduced; rankings expose their
      calculation and data-quality context (Principle II)
- [ ] Tests were written first (Red), fail for the intended reason, then
      pass (Green), with any refactor preserving behaviour (Principle III)
- [ ] CI is green: format, lint, strict TypeScript, unit, metric/data-
      contract tests, production build, PWA/service-worker, Docker build,
      browser smoke test (Principle III)
- [ ] No test or CI step requires a live Asana workspace or a real personal
      access token (Principle III, IV)
- [ ] No token appears in URLs, logs, error reports, analytics, source
      control, fixtures, screenshots, artefacts, or exported data
      (Principle IV)
- [ ] Asana access remains read-only and minimal; any write capability is
      out of scope without a dedicated specification (Principle IV)
- [ ] Refresh atomicity and known-good cache fallback are preserved; a
      partial or failed refresh cannot replace good data (Principle V)
- [ ] `gid` values are handled as opaque strings; deleted or inaccessible
      records are never treated as completed work (Principle V)
- [ ] Any IndexedDB schema migration is versioned, tested, and does not
      silently discard credentials or history (Principle V)
- [ ] Architecture remains the simplest that satisfies the specification;
      new dependencies are justified (Principle VI)
- [ ] Accessibility, status transparency (last refresh, timezone, filters,
      date basis, cached/offline status), and required UI states are
      covered (Principle VII)
- [ ] Performance budgets checked against a generated dataset of up to
      25,000 tasks where the change affects startup, filtering, grouping,
      charts, or refresh (Principle VII)
- [ ] Documentation (README, decision records, user-facing explanations)
      is updated, and a reproducible verification step is included
      (Principle VIII)

## Governance and Enforcement

This constitution governs every later specification, plan, task list, pull
request, and release. Where another project artefact conflicts with it,
the constitution prevails until deliberately amended.

The constitution uses semantic versioning: MAJOR for backward-incompatible
principle or governance removals or redefinitions, MINOR for new or
materially expanded principles, and PATCH for clarifications that do not
change obligations. Every amendment MUST record its reason, the affected
sections, any migration or follow-up work, the approval date, and the
resulting version change. A rule MUST NOT be weakened merely to accommodate
an implementation that has already diverged from it.

Plans and pull requests MUST include a constitution check covering the
applicable principles above, test evidence, privacy/security impact,
metric-definition impact, storage/migration impact, documentation impact,
and CI status. Any exception MUST be explicit, narrowly scoped, justified
in the plan or PR description, time-limited where possible, and
accompanied by a tracked remediation; silent exceptions are prohibited.

The definition of done for any behaviour-changing task is: accepted
requirements, implementation, passing automated tests, successful CI,
accessible user behaviour, a security/privacy review proportionate to
risk, updated documentation, and a reproducible verification step.

Project documentation MUST use Australian English.

**Version**: 1.0.0 | **Ratified**: 2026-07-20 | **Last Amended**: 2026-07-20
