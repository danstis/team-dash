/**
 * T038 — US1 integration test: token is never rendered, logged, or
 * embedded in any URL — only a masked identifier appears.
 *
 * Spec contract this file pins:
 *
 *   Spec.md acceptance scenario 7 of US1: "Given a token is stored or
 *   in use, when the user views any screen, log, exported content, or
 *   URL, then the full token value is never displayed, logged, or
 *   embedded — at most a masked/partial identifier is shown."
 *
 *   Spec.md FR-008: "The system MUST NOT display the complete token
 *   value once entered (at most a masked/partial representation may be
 *   shown), and MUST NOT include the token in logs, diagnostics,
 *   exported content, or URLs."
 *
 *   Constitution Principle IV: tokens MUST NEVER appear in URLs, logs,
 *   error reports, analytics, source control, fixtures, screenshots,
 *   build artefacts, service-worker caches, or exported reporting data.
 *
 *   data-model.md `CredentialRecord.maskedIdentifier`: "e.g. last 4
 *   characters, the only representation ever rendered."
 *
 *   tasks.md T038 / BSOD-166: "Integration test: token is never
 *   rendered, logged, or embedded in a URL — only a masked identifier
 *   appears in `tests/integration/credentials/token-masking.test.tsx`."
 *
 * Boundary scope
 * --------------
 * T031 (BSOD-159, the app shell) unit-tests the *context value*
 * surface: `tests/unit/app/credentials-context.test.tsx` asserts the
 * `useCredentials()` value never carries the plaintext token in any
 * state field (its `valueContainsPlaintextToken` helper pattern).
 * That unit test pins the in-memory boundary of the provider.
 *
 * T038 is the *user-facing* boundary: even when the rest of the app
 * renders credential surfaces (the future T044 `<MaskedToken />`
 * component, T045 `<SettingsCredentialsPanel />`, and any URL/log/
 * error path triggered by the user flow), the plaintext token MUST
 * never reach the user-visible markup, the browser URL bar, or the
 * developer console. The per-context unit test cannot catch a
 * regression in a *consumer* of the context (a future component that
 * takes the token as a prop, `console.log`s it for "debugging", or
 * ships it as a URL parameter).
 *
 * What this integration test exercises:
 *
 *   1. The token is set via the same public surface the future
 *      `TokenEntryForm` (T041) will call (`setSessionToken` /
 *      `setPersistentToken` with a `(token, maskedIdentifier)` tuple).
 *   2. A probe component (test-local; simulating the user-visible
 *      MaskedToken + SettingsCredentialsPanel surfaces) renders into
 *      the document tree.
 *   3. The rendered DOM, the current URL (location.href / search /
 *      hash), and the captured console output are scanned for the
 *      full plaintext token. None of them carries it. The rendered DOM
 *      carries the masked identifier — last 4 characters plus a
 *      recognisable prefix that disambiguates "masked" from "raw".
 *   4. After `clearAll`, no token surface — masked or otherwise —
 *      remains in the DOM.
 *
 * What this integration test deliberately does NOT cover:
 *
 *   - The encrypt/decrypt round-trip (T027/T028, BSOD-155/156 own
 *     that). The provider's persistence path is the future
 *     `CredentialRepository`'s (T040); T038 verifies the *boundary*,
 *     not the storage path.
 *   - The Asana HTTP client's URL-scrub (T025/T026, BSOD-153/154
 *     own that). T038 verifies the URL safety of the *credential
 *     surface*, not the API call surface.
 *   - The masked-identifier *algorithm* (T044). The future
 *     `<MaskedToken />` component is the source of truth for the
 *     exact rendering format. T038 only requires that *whatever* the
 *     masked identifier is, it appears in the DOM, and the
 *     plaintext does not.
 *   - Console output from third-party libraries (MSW emits noisy
 *     warnings when no handlers match; those are out of T038's
 *     scope — T038 filters the captured console arguments down to
 *     token-bearing ones).
 *
 * Red/Green/Refactor sequencing:
 *
 *   Per Constitution Principle III, this test was authored before
 *   the user-facing implementation lands. On the day the test
 *   was authored (BSOD-166 / T038), the credentials UI surface
 *   (`<MaskedToken />`, `<SettingsCredentialsPanel />`, the
 *   `<TokenEntryForm />`, the route guard T046) does not exist;
 *   the only thing in the app that knows about a credential is the
 *   T031 `<CredentialsProvider />`. This file is therefore a probe
 *   against the existing surface — the probe will pin the contract
 *   for future consumers and fail loudly when one of them widens the
 *   boundary.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import {
  CredentialsProvider,
  useCredentials,
} from "../../../src/app/credentials-context";
import { WorkspaceProvider } from "../../../src/app/workspace-context";
import { db } from "../../../src/data/db/schema";

/* -------------------------------------------------------------------------- */
/* Test fixtures                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A plaintext token value deliberately engineered so its middle
 * substring is unique enough to never collide with anything else in
 * the rendered markup. The last 4 characters are kept distinct from
 * the middle so a buggy masked-identifier implementation can be
 * distinguished from a correct one.
 *
 * Format reminder: Asana PATs are typically `<digits>:<hex>`, but the
 * provider is agnostic about the format (it accepts any non-empty
 * string). A clearly-fake "team-dash T038 marker" prefix makes any
 * accidental render in a log file obvious at a glance — even a
 * truncated capture of the full plaintext betrays itself.
 */
const PLAINTEXT_TOKEN = "team-dash-T038-do-not-render-7z9k";

/**
 * The masked identifier this test's producer (the future
 * `<TokenEntryForm />` or `<SettingsCredentialsPanel />`) feeds into
 * the context. Per data-model.md / FR-008 the masked representation
 * is `…` + the last 4 characters of the plaintext. The leading
 * horizontal-ellipsis is part of the convention the existing T031
 * unit test (`tests/unit/app/credentials-context.test.tsx`) already
 * uses, so the convention is consistent with the rest of the
 * surface.
 */
const MASKED_IDENTIFIER = "…7z9k";

/**
 * A unique substring used to make negative assertions robust. The
 * middle of `PLAINTEXT_TOKEN` (`team-dash-T038-do-not-render`) must
 * not appear in the rendered DOM under any of the surfaces we
 * exercise — if it does, the contract is broken.
 */
const PLAINTEXT_MARKER_MIDDLE = "team-dash-T038-do-not-render";

/* -------------------------------------------------------------------------- */
/* Probe component                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A test-local probe component that simulates the user-visible
 * credential surface — the future `<MaskedToken />` (T044) rendered
 * inside the future `<SettingsCredentialsPanel />` (T045).
 *
 * The probe intentionally does NOT receive the plaintext token as a
 * prop. It reads its rendering data exclusively from
 * `useCredentials()`, the same way the real components will
 * (`useCredentials().maskedIdentifier` is the future MaskedToken's
 * prop). A regression where a future implementation accidentally
 * forwards the plaintext token as a prop would surface here as the
 * probe only rendering what the context gives it — the bug would
 * still exist in the real component, but the probe pins the *safe*
 * shape so a new probe-attached helper regression can be caught.
 *
 * The probe renders three user-visible surfaces T038 cares about:
 *
 *   - The masked identifier ("token: …7z9k") — `data-testid="probe-masked"`
 *   - The current storage mode ("session" / "persistent" / "none") —
 *     `data-testid="probe-mode"`
 *   - The derived `ViewState` ("first_run" / "ready" / …) —
 *     `data-testid="probe-state"`
 *
 * No surface receives `PLAINTEXT_TOKEN`. If the contract holds, the
 * plaintext token never appears in `document.body.innerHTML`, the
 * URL, or the captured console output.
 */
function Probe(): React.ReactElement {
  const credentials = useCredentials();
  return (
    <section data-testid="credential-surface">
      <span data-testid="probe-masked">{credentials.maskedIdentifier}</span>
      <span data-testid="probe-mode">{credentials.mode ?? "none"}</span>
      <span data-testid="probe-state">{credentials.state}</span>
    </section>
  );
}

/**
 * Module-scoped holder for the live `useCredentials()` value.
 * Populated by `<CredentialsControlHarness />` on every render of
 * the harness tree. Cleared between tests in `afterEach`.
 */
let capturedCredentialsValue: ReturnType<typeof useCredentials> | null = null;

/**
 * Internal harness component. Renders nothing visible; captures the
 * credentials context value into the module-scoped holder so the
 * test body can call the action methods. Co-located in the same
 * tree as `<Probe />` so both observe the same React state.
 */
function CredentialsControlHarness(): null {
  capturedCredentialsValue = useCredentials();
  return null;
}

/**
 * Render the providers + the probe + the action harness in a single
 * tree. The probe and the harness share the same React state, so an
 * action called via `getCredentials().setSessionToken(...)` is
 * observable by `screen.getByTestId(...)` immediately on the next
 * `waitFor` poll. Returns the render result so the caller can pass
 * it to `waitFor`.
 *
 * The providers are mounted in the order the production `<App />`
 * mounts them (CredentialsProvider outermost so WorkspaceProvider
 * could read it if a future story needs to — per `src/app/App.tsx`).
 */
function renderProbe(): ReturnType<typeof render> {
  return render(
    <CredentialsProvider>
      <WorkspaceProvider>
        <Probe />
        <CredentialsControlHarness />
      </WorkspaceProvider>
    </CredentialsProvider>,
  );
}

/**
 * Read the captured credentials value out of the most-recent
 * `renderProbe()` call. Throws if called before a render completed
 * so a misordered test gets a clear stack trace.
 */
function getCredentials(): ReturnType<typeof useCredentials> {
  if (capturedCredentialsValue === null) {
    throw new Error(
      "getCredentials called before renderProbe — did the test forget the render?",
    );
  }
  return capturedCredentialsValue;
}

/* -------------------------------------------------------------------------- */
/* DOM / URL / console safety helpers                                        */
/* -------------------------------------------------------------------------- */

/**
 * Spy on console.{log,warn,error,info,debug} so we can assert no
 * token-bearing argument was ever emitted. MSW and a few other
 * libraries log during a normal test boot — T038 only cares about
 * *token-bearing* arguments; non-token noise is filtered out below.
 */
const consoleSpies: Array<MockInstance<(...args: unknown[]) => void>> = [];

function installConsoleSpies(): void {
  for (const method of ["log", "warn", "error", "info", "debug"] as const) {
    consoleSpies.push(
      vi.spyOn(console, method).mockImplementation(() => {
        /* swallowed so test output stays clean */
      }),
    );
  }
}

function restoreConsoleSpies(): void {
  for (const spy of consoleSpies) {
    spy.mockRestore();
  }
  consoleSpies.length = 0;
}

/**
 * Return every captured console argument string across every
 * `console.*` method the spies cover. The transitive arguments are
 * flattened through `String()` so JSX objects, errors, and plain
 * strings are all matched uniformly. The plaintext token is searched
 * for as a substring (not as a full match) to also catch a
 * regression where a contributor "salts" the log with a literal token
 * next to other context — `team-dash-T038-do-not-render-7z9k` is
 * unique enough that no legitimate log line should ever mention it.
 */
function capturedConsoleText(): string {
  const fragments: string[] = [];
  for (const spy of consoleSpies) {
    for (const call of spy.mock.calls) {
      for (const arg of call) {
        fragments.push(stringifyForScan(arg));
      }
    }
  }
  return fragments.join("\n");
}

function stringifyForScan(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.message + " " + (value.stack ?? "");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Spy on `history.pushState` and `history.replaceState`. React
 * Router 8's `createMemoryRouter` does not touch the browser
 * `window.history` (urls are kept in router-internal memory), but a
 * future swap to `createBrowserRouter` would. This spy pins the
 * invariant for that future change too: any caller passing the
 * plaintext token (or its cleartext prefix) to `pushState` /
 * `replaceState` is recorded here.
 */
const historySpies: Array<MockInstance<(...args: unknown[]) => void>> = [];

function installHistorySpies(): void {
  historySpies.push(vi.spyOn(window.history, "pushState"));
  historySpies.push(vi.spyOn(window.history, "replaceState"));
}

function restoreHistorySpies(): void {
  for (const spy of historySpies) {
    spy.mockRestore();
  }
  historySpies.length = 0;
}

function capturedHistoryUrls(): string[] {
  const urls: string[] = [];
  for (const spy of historySpies) {
    for (const call of spy.mock.calls) {
      const url = call[2];
      if (typeof url === "string") {
        urls.push(url);
      }
    }
  }
  return urls;
}

/* -------------------------------------------------------------------------- */
/* Test suite                                                                */
/* -------------------------------------------------------------------------- */

describe("T038 / BSOD-166 — token is never rendered, logged, or embedded in any URL", () => {
  beforeAll(() => {
    installConsoleSpies();
    installHistorySpies();
  });

  beforeEach(async () => {
    // The T031 CredentialsProvider reads IndexedDB on mount (FR-002a).
    // Clear the table between tests so a previous test's persistent
    // record does not leak through and pin the wrong `ViewState`.
    // See the equivalent guards in `tests/unit/app/credentials-context.test.tsx`.
    await db.credentials.clear();
    await db.workspaces.clear();
  });

  afterEach(async () => {
    cleanup();
    // Reset every spy's recorded calls but keep the spies themselves
    // installed across the whole suite so a single test's accidental
    // log emissions do not silently survive into the next test.
    for (const spy of consoleSpies) {
      spy.mockClear();
    }
    for (const spy of historySpies) {
      spy.mockClear();
    }
    capturedCredentialsValue = null;
    await db.credentials.clear();
    await db.workspaces.clear();
  });

  afterAll(() => {
    restoreConsoleSpies();
    restoreHistorySpies();
  });

  /* ----------------------------- Masking ------------------------------ */

  describe("masked-identifier visibility (FR-008 / data-model.md `maskedIdentifier`)", () => {
    it("renders the masked identifier in the document when a session token is set", async () => {
      renderProbe();

      // First: confirm the initial first_run state has no masked
      // identifier rendered (the probe renders an empty string when
      // maskedIdentifier is empty).
      await waitFor(() => {
        expect(screen.getByTestId("probe-state").textContent).toBe("first_run");
      });
      expect(screen.getByTestId("probe-masked").textContent).toBe("");

      const credentials = getCredentials();

      // Set a session token — the same action the future
      // <TokenEntryForm /> will call after "Test token" succeeds.
      await actAsync(() =>
        credentials.setSessionToken(PLAINTEXT_TOKEN, MASKED_IDENTIFIER),
      );

      await waitFor(() => {
        expect(screen.getByTestId("probe-masked").textContent).toBe(
          MASKED_IDENTIFIER,
        );
      });

      // The masked identifier MUST include the last 4 characters of
      // the plaintext — that's the contract. The provider does not
      // compute the masked form itself (T044 owns the algorithm); it
      // accepts it as a parameter and surfaces it verbatim. This
      // assertion locks the parameter shape that T044 must produce.
      expect(MASKED_IDENTIFIER).toBe("…7z9k");
      expect(
        screen.getByTestId("probe-masked").textContent?.endsWith("7z9k"),
      ).toBe(true);
    });

    it("renders the masked identifier when a persistent token is set", async () => {
      renderProbe();
      await waitFor(() => {
        expect(screen.getByTestId("probe-state").textContent).toBe("first_run");
      });

      const credentials = getCredentials();
      await actAsync(() =>
        credentials.setPersistentToken(PLAINTEXT_TOKEN, MASKED_IDENTIFIER),
      );

      await waitFor(() => {
        expect(screen.getByTestId("probe-state").textContent).toBe("ready");
      });
      expect(screen.getByTestId("probe-mode").textContent).toBe("persistent");
      expect(screen.getByTestId("probe-masked").textContent).toBe(
        MASKED_IDENTIFIER,
      );
    });
  });

  /* ------------------------------ DOM --------------------------------- */

  describe("rendered DOM does not leak the plaintext token (FR-008 / US1 scenario 7)", () => {
    it("does not render the plaintext token anywhere in document.body.innerHTML (session mode)", async () => {
      renderProbe();
      await waitFor(() => {
        expect(screen.getByTestId("probe-state").textContent).toBe("first_run");
      });

      const credentials = getCredentials();
      await actAsync(() =>
        credentials.setSessionToken(PLAINTEXT_TOKEN, MASKED_IDENTIFIER),
      );

      await waitFor(() => {
        expect(screen.getByTestId("probe-state").textContent).toBe("ready");
      });

      const html = document.body.innerHTML;
      expect(html).not.toContain(PLAINTEXT_TOKEN);
      // The middle substring is independently unique — assert on it
      // too so a sloppy future implementation that "scrambles"
      // (e.g. base64, partial hash, or token.with(4, "*")) cannot
      // pass by accident.
      expect(html).not.toContain(PLAINTEXT_MARKER_MIDDLE);
    });

    it("does not render the plaintext token anywhere in document.body.innerHTML (persistent mode)", async () => {
      renderProbe();
      await waitFor(() => {
        expect(screen.getByTestId("probe-state").textContent).toBe("first_run");
      });

      const credentials = getCredentials();
      await actAsync(() =>
        credentials.setPersistentToken(PLAINTEXT_TOKEN, MASKED_IDENTIFIER),
      );

      await waitFor(() => {
        expect(screen.getByTestId("probe-state").textContent).toBe("ready");
      });

      const html = document.body.innerHTML;
      expect(html).not.toContain(PLAINTEXT_TOKEN);
      expect(html).not.toContain(PLAINTEXT_MARKER_MIDDLE);
    });

    it("does not carry the plaintext token in any HTML attribute (data-*, aria-*, href, src, …)", async () => {
      // The previous assertions cover `innerHTML` text content, but a
      // bug could embed the token in an attribute (e.g. `data-token=`).
      // Walk every attribute on every element and confirm none of
      // them carry the plaintext.
      renderProbe();
      await waitFor(() => {
        expect(screen.getByTestId("probe-state").textContent).toBe("first_run");
      });

      const credentials = getCredentials();
      await actAsync(() =>
        credentials.setSessionToken(PLAINTEXT_TOKEN, MASKED_IDENTIFIER),
      );
      await waitFor(() => {
        expect(screen.getByTestId("probe-state").textContent).toBe("ready");
      });

      for (const element of Array.from(document.body.querySelectorAll("*"))) {
        for (const attribute of Array.from(element.attributes)) {
          expect(
            attribute.value,
            `${element.tagName}[${attribute.name}]`,
          ).not.toContain(PLAINTEXT_TOKEN);
          expect(
            attribute.value,
            `${element.tagName}[${attribute.name}]`,
          ).not.toContain(PLAINTEXT_MARKER_MIDDLE);
        }
      }
    });

    it("clears every credential surface after clearAll", async () => {
      renderProbe();
      await waitFor(() => {
        expect(screen.getByTestId("probe-state").textContent).toBe("first_run");
      });

      const credentials = getCredentials();
      await actAsync(() =>
        credentials.setPersistentToken(PLAINTEXT_TOKEN, MASKED_IDENTIFIER),
      );
      await waitFor(() => {
        expect(screen.getByTestId("probe-state").textContent).toBe("ready");
      });

      // Sanity check — the masked identifier is rendered before clear.
      expect(screen.getByTestId("probe-masked").textContent).toBe(
        MASKED_IDENTIFIER,
      );

      await actAsync(() => credentials.clearAll());

      await waitFor(() => {
        expect(screen.getByTestId("probe-state").textContent).toBe("first_run");
      });
      expect(screen.getByTestId("probe-masked").textContent).toBe("");
      expect(document.body.innerHTML).not.toContain(PLAINTEXT_TOKEN);
      expect(document.body.innerHTML).not.toContain(PLAINTEXT_MARKER_MIDDLE);
    });
  });

  /* ------------------------------ URL --------------------------------- */

  describe("URL surface (browser location bar, pushState, replaceState) is free of the token", () => {
    it("never places the plaintext token in window.location (href / search / hash / pathname)", async () => {
      renderProbe();
      await waitFor(() => {
        expect(screen.getByTestId("probe-state").textContent).toBe("first_run");
      });

      const credentials = getCredentials();
      await actAsync(() =>
        credentials.setSessionToken(PLAINTEXT_TOKEN, MASKED_IDENTIFIER),
      );
      await waitFor(() => {
        expect(screen.getByTestId("probe-state").textContent).toBe("ready");
      });

      const location = window.location;
      expect(location.href).not.toContain(PLAINTEXT_TOKEN);
      expect(location.search).not.toContain(PLAINTEXT_TOKEN);
      expect(location.hash).not.toContain(PLAINTEXT_TOKEN);
      expect(location.pathname).not.toContain(PLAINTEXT_TOKEN);
      // The middle marker is independently unique — assert on it too
      // so a regression that splits the token across query-string
      // fields still fails.
      expect(location.href).not.toContain(PLAINTEXT_MARKER_MIDDLE);
    });

    it("never passes the plaintext token to history.pushState or history.replaceState", async () => {
      renderProbe();
      await waitFor(() => {
        expect(screen.getByTestId("probe-state").textContent).toBe("first_run");
      });

      const credentials = getCredentials();
      await actAsync(() =>
        credentials.setPersistentToken(PLAINTEXT_TOKEN, MASKED_IDENTIFIER),
      );
      await waitFor(() => {
        expect(screen.getByTestId("probe-state").textContent).toBe("ready");
      });

      const urls = capturedHistoryUrls();
      for (const url of urls) {
        expect(url).not.toContain(PLAINTEXT_TOKEN);
        expect(url).not.toContain(PLAINTEXT_MARKER_MIDDLE);
      }
    });
  });

  /* ----------------------------- Console ------------------------------ */

  describe("console surface (log / warn / error / info / debug) is free of the token", () => {
    it("never logs the plaintext token via console.* during the session-mode flow", async () => {
      renderProbe();
      await waitFor(() => {
        expect(screen.getByTestId("probe-state").textContent).toBe("first_run");
      });

      const credentials = getCredentials();
      await actAsync(() =>
        credentials.setSessionToken(PLAINTEXT_TOKEN, MASKED_IDENTIFIER),
      );
      await waitFor(() => {
        expect(screen.getByTestId("probe-state").textContent).toBe("ready");
      });

      const captured = capturedConsoleText();
      expect(captured).not.toContain(PLAINTEXT_TOKEN);
      expect(captured).not.toContain(PLAINTEXT_MARKER_MIDDLE);
    });

    it("never logs the plaintext token via console.* during the persistent-mode flow", async () => {
      renderProbe();
      await waitFor(() => {
        expect(screen.getByTestId("probe-state").textContent).toBe("first_run");
      });

      const credentials = getCredentials();
      await actAsync(() =>
        credentials.setPersistentToken(PLAINTEXT_TOKEN, MASKED_IDENTIFIER),
      );
      await waitFor(() => {
        expect(screen.getByTestId("probe-state").textContent).toBe("ready");
      });

      const captured = capturedConsoleText();
      expect(captured).not.toContain(PLAINTEXT_TOKEN);
      expect(captured).not.toContain(PLAINTEXT_MARKER_MIDDLE);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Test-local helpers                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Wrap an async action call in `act()` so React commits the resulting
 * state update before the next `waitFor` polls. The provider's
 * callbacks are `async` so `act` awaits their completion; we use the
 * explicit `act` import (`react`) rather than the RTL one because
 * the wrapper just needs to commit, not to find-by-anything.
 */
async function actAsync(action: () => Promise<void>): Promise<void> {
  const { act } = await import("react");
  await act(async () => {
    await action();
  });
}
