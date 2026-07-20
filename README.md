# Team Dash

Team Dash is a self-hosted, single-user Progressive Web App (PWA) for viewing Asana team performance and workload. It retrieves reportable work from one selected Asana workspace and presents transparent, drillable, deduplicated reports for work added, work completed, backlog size, and backlog direction.

## Product boundary

Team Dash is deliberately a browser-only, local-first application:

- The browser calls Asana directly through a read-only client. The client uses `GET` requests only; it does not create, edit, complete, assign, or delete Asana resources.
- A user supplies one Asana personal access token (PAT) and selects one accessible workspace. There is no application login, multi-user access control, shared dashboard, or OAuth flow.
- Asana data, credentials, snapshots, team mappings, named Person Groups, and settings remain in the browser's IndexedDB or in-memory session state. There is no Team Dash backend, reporting database, telemetry, or shared server-side state.
- Only active, in-scope project work is reported. Archived projects and their tasks, personal "My Tasks" items without an in-scope project, milestones, and approval items are excluded. Standard tasks and subtasks are included, with subtasks resolving project membership from their parent when necessary.
- Tasks are deduplicated by their opaque Asana `gid` at workspace, portfolio, team, assignee, and other aggregate levels. Drill-down still shows every project membership.
- Refresh is manual and user initiated. Scheduled or background refresh and any write capability are outside the product boundary.

The first delivery slice covers credential setup, workspace selection, refresh, local caching, freshness status, task filtering and drill-down, work-added-versus-completed reporting, and backlog reporting. Additional diagnostic metrics are added incrementally.

## Prerequisites

For local development and the automated checks, install:

- Node.js 24 Active LTS. The repository pins the major version in `.nvmrc` and `package.json`.
- npm, supplied with Node.js 24.
- Docker Engine or Docker Desktop for the self-hosted container path.
- An evergreen browser with IndexedDB and Service Worker support, such as a current Chrome, Edge, or Firefox, for interactive use.

A real Asana account and PAT are **not** required for the automated tests or the deterministic fixture-backed development flow. Docker is only required for container validation and deployment.

## Personal access token risks

Treat an Asana PAT as a high-value secret.

- Use a token intended for this local installation and revoke or rotate it in Asana when it is no longer needed. The application uses the token for read-only requests, but the token itself must still be protected as a credential.
- Session-only storage is the default. In this mode the token is held in memory for the current session and is not written to persistent browser storage.
- Persistent storage requires an explicit confirmation. The token is encrypted at rest with Web Crypto AES-GCM using a non-extractable key stored alongside the encrypted record in IndexedDB. This reduces the risk of someone reading a copied browser-profile database as raw plaintext.
- Encryption at rest does not protect against an attacker who can execute JavaScript in the Team Dash origin, such as an XSS vulnerability or a compromised browser profile running the application. Persistent mode therefore remains a convenience with a stated risk, not a replacement for endpoint security.
- The complete token is never rendered, logged, placed in a URL, included in an export, or added to an error message. It is sent only in an `Authorization: Bearer` header for an individual Asana request.
- Never commit a PAT, put one in a fixture, paste one into an issue, add one to a screenshot, or store one in a shell command, `.env` file, browser bookmark, or URL. Automated tests use mocks and synthetic values only.
- The Docker image is a static file server. It does not receive, proxy, log, or persist PATs. Network-level access control for a self-hosted container is the operator's responsibility.

If a token may have been exposed, stop using it, clear Team Dash data, and revoke or rotate the token through Asana before continuing.

## Local development

Clone the repository, select Node.js 24, install the locked dependencies, and start the development server:

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. Development and test requests use the deterministic MSW fixture setup by default, so the first-run credential flow can be exercised without a live workspace. A real PAT is only needed when intentionally testing the direct Asana integration outside the fixture flow.

The development application is expected to provide a first-run credential screen. The normal P1 path is:

1. Enter a fixture token and choose **Test token**.
2. Select the fixture workspace and choose session-only storage.
3. Run **Refresh** and confirm progress and a successful last-refresh timestamp.
4. Reload and confirm the data is labelled cached.
5. Open the task table, combine a date-range and assignee filter, clear the filters, and drill into a multi-project task.
6. Open the work-added-versus-completed and backlog views and compare their values with the fixture expectations.

No application environment file is required for the fixture flow. Do not add secrets to local configuration. If a future deployment needs configuration, use safe placeholders in committed examples and keep real values outside source control.

## Testing and quality checks

All checks are deterministic and must work without a real Asana workspace or PAT:

```bash
npm run lint
npm run format:check
npm run typecheck
npm run test:unit
npm run test:contract
npm run build
npm run test:e2e
```

The checks cover:

- ESLint, including the boundary that keeps pure domain logic separate from React, browser, and network code.
- Prettier formatting and strict TypeScript compilation.
- Vitest unit tests for metric, filtering, deduplication, and date logic.
- Vitest and MSW contract tests for Asana response handling, read-only requests, IndexedDB schema, migrations, and refresh atomicity.
- The production Vite/PWA build and service-worker output.
- Playwright browser smoke tests for first-run, offline viewing, PWA behaviour, and recovery states.

For a first-time Playwright setup, install the browsers required by the project before running the end-to-end suite:

```bash
npx playwright install
```

Do not substitute a real PAT or live Asana data in tests. Use the small fixture for expected metric values and the generated large fixture when validating the 25,000-task performance budgets.

## Docker deployment

Build and run the static production image from the repository root:

```bash
docker build -f docker/Dockerfile -t team-dash .
docker run --rm -p 8080:80 team-dash
```

Open `http://localhost:8080`. The image uses a Node.js 24 build stage and an nginx 1.30 Alpine runtime stage. nginx serves only the compiled static assets, provides SPA fallback routing, sends `Cache-Control: no-cache` for the service worker, and long-caches hashed assets.

The container has no backend behaviour and no server-side Asana credentials. In a production build, the browser still needs a valid user-supplied PAT to call Asana. The fixture-backed mock development flow is not a substitute for production access, and the container must not be given a PAT through Docker arguments or environment variables.

For a self-hosted deployment, place the container behind the operator's normal network and access controls. Use HTTPS and restrict who can reach the service, because anyone able to use the application may access the local browser data and any active session credential in that browser.

## Browser storage and privacy implications

IndexedDB is the source of local persistence. Depending on the selected workspace, it may contain cached workspaces, projects, portfolios, teams, users, tasks, dependencies, snapshots, refresh state, team-mapping overrides, and named Person Groups. The cache is scoped by workspace; switching workspaces must not merge their data.

A refresh is staged and committed only after it completes successfully. A failed, cancelled, rate-limited, unauthorised, or interrupted refresh leaves the last complete cache and its snapshots available. Cached data must be labelled as cached or stale when it has not been refreshed successfully.

Snapshots are a derived performance cache for reconstructed backlog history, not an immutable audit record. They are backfilled from the currently cached task dates and current estimates. Historical figures may change after a later refresh if task scope changes, and historical effort uses the latest known estimate retroactively because Asana does not provide historical estimate values.

Browser storage has normal browser risks and limits:

- Clearing site data, using a private browsing profile, changing browser profiles, browser storage eviction, or exceeding the IndexedDB quota can remove or prevent access to local data.
- A browser extension, malware, or JavaScript executing in the Team Dash origin may be able to inspect or use data available to that origin. Keep the browser and self-hosted deployment protected.
- The service worker caches the application shell for offline use, not authenticated Asana API responses or PATs. The application owns retained Asana data through IndexedDB.
- There is no Team Dash server copy to recover if local data is cleared. Backups and retention of any browser profile are the operator's responsibility; report export/import is outside the MVP.

## Offline limitations

After at least one successful refresh and service-worker installation, the application can open the last complete locally cached dashboard and reconstructed snapshot history while offline. It clearly marks the view as offline/cached and disables or labels **Refresh** as unavailable.

Offline mode cannot:

- validate, replace, revoke, or newly retrieve a PAT;
- discover workspaces or retrieve changes from Asana;
- repair a missing or corrupt local cache;
- show changes made in Asana after the last successful refresh; or
- provide data on a first visit when no complete local cache exists.

If session-only credentials have been lost when the browser session ends, the user must enter the PAT again once online. A persistent credential can be decrypted on launch by the application, but it still cannot refresh until network access is restored.

## Clearing data and credentials

Use the application's explicit clear-data action in **Settings** when resetting an installation or responding to a possible token exposure. It removes, together and in one operation:

- the active session or persistent credential;
- the encrypted persistent token and its associated non-extractable key;
- cached Asana entities and refresh state;
- reconstructed backlog snapshots;
- reporting-team overrides; and
- named Person Groups.

To stop using persistent storage without deleting the rest of the cache, switch back to session-only mode. To replace a PAT, use the credential replacement flow. Both actions immediately delete the previous encrypted token record and key; they do not wait for a full clear-data action.

For a complete browser reset after using the in-app action, remove the site's browser data through the browser's site settings or developer tools and uninstall the PWA if it was installed. A browser-level reset is destructive and cannot be undone by Team Dash. There is no server-side Team Dash data to clear.

## Troubleshooting

### `npm ci` fails or the wrong Node version is reported

Confirm `node --version` is Node 24 and `npm --version` is the npm version shipped with it. Use a version manager with `.nvmrc`, then remove only the local `node_modules` directory and retry `npm ci`. Do not delete or regenerate `package-lock.json` as a workaround.

### The development server will not start

Check whether the Vite port is already in use, stop the conflicting process, and run `npm run dev` again. If the page is blank, check the browser console for build errors and confirm the fixture setup is enabled. Do not paste a PAT into console output or issue reports.

### Test or build commands cannot be found

Run `npm ci` from the repository root and confirm the command is listed in `package.json`. The supported commands are the scripts in the Testing and quality checks section; invoke them through npm rather than relying on globally installed tools.

### Test token fails in the fixture flow

Use a non-empty synthetic token and ensure the mock service worker is active. A fixture failure is not evidence that a real PAT is valid. For a real Asana test, check that the token has access to at least one workspace and that the browser can reach Asana; never include the token in diagnostic output.

### The app shows cached data or Refresh is unavailable

Check the offline indicator and the last successful refresh time. Restore network access and run a manual refresh. A partial or failed refresh intentionally preserves the previous known-good cache rather than presenting incomplete data as current.

### No projects or tasks appear

Confirm that the selected workspace contains accessible, active projects. Archived projects, personal My Tasks items without an in-scope project, milestones, approvals, and tasks outside the selected workspace are intentionally excluded. Review the latest data-quality and refresh outcome details rather than treating an empty result as a successful empty report.

### Persistent credentials or cached data disappeared

Check whether site data was cleared, the browser changed profiles, private browsing was used, storage eviction occurred, or the IndexedDB quota was exceeded. A persistent-token decrypt failure intentionally falls back to the first-run credential screen; re-enter the PAT rather than attempting to recover a raw storage record.

### The Docker page returns a 404 on a client route

Confirm that the image was built from the repository root with `docker build -f docker/Dockerfile -t team-dash .`, that port `8080` is mapped to container port `80`, and that the nginx configuration includes SPA fallback routing. Rebuild after changing frontend files so the new `dist/` output is copied into the image.

### A security or credential-handling problem is suspected

Do not publish exploit details or tokens in an issue. Follow the private reporting process in [SECURITY.md](./SECURITY.md). For normal usage help, see [SUPPORT.md](./SUPPORT.md).

## Project documentation

- [Feature specification](./specs/001-asana-team-dashboard/spec.md)
- [Implementation plan](./specs/001-asana-team-dashboard/plan.md)
- [Quickstart](./specs/001-asana-team-dashboard/quickstart.md)
- [Contributing](./CONTRIBUTING.md)
- [Security policy](./SECURITY.md)
- [Support](./SUPPORT.md)
