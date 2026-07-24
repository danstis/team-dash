/**
 * T031 — the `<App />` shell component.
 *
 * The app shell (Constitution Principle I "remain runnable after every
 * completed delivery task", plan.md Project Structure) is the entry
 * point every feature imports across. Its job is small and
 * architectural:
 *
 * 1. Mount the top-level provider tree (`CredentialsProvider`,
 *    `WorkspaceProvider`).
 * 2. Hand the tree to a router (`<RouterProvider router={router} />`).
 *
 * That is the whole file. No business logic, no feature imports, no
 * data fetching — feature components hang off routes registered
 * against `router` (in `src/app/router.tsx`) and consume the
 * providers via the `useCredentials` / `useWorkspace` hooks.
 *
 * ## Why a thin shell
 *
 * A shell that imports feature components is the wrong direction:
 * features depend on the shell, not the other way around. A future
 * contributor who adds an import from `src/features/**` here would
 * invert the dependency and make per-feature unit testing harder
 * (every feature test would have to render the whole shell). The
 * rule is: the shell mounts providers and a router; features mount
 * under the router.
 *
 * This "shell does not import features" discipline is architectural
 * convention, not lint-enforced; the `eslint-plugin-boundaries`
 * configuration in `eslint.config.js` constrains `src/domain/**`
 * only. The convention is what every existing feature test relies
 * on to render a single feature in isolation.
 *
 * ## Provider order
 *
 * `CredentialsProvider` is mounted outside `WorkspaceProvider` so the
 * workspace context can read the credentials context if a future
 * story decides the workspace lookup needs to wait for a validated
 * token. T031 does not couple the two — both providers resolve
 * independently on mount — but the order is fixed so the future
 * coupling is a textual change, not a structural one.
 *
 * ## React.StrictMode
 *
 * The shell is rendered under `<StrictMode>` so dev double-invokes
 * the providers' lifecycle methods (T031's tests assert this is
 * safe). A future contributor who adds an effectful side-channel
 * that breaks under double-invocation (e.g. an IndexedDB write in
 * render) fails the existing test rather than shipping a dev-only
 * bug to production.
 */
import { type ReactNode, StrictMode } from "react";

import { CredentialsProvider } from "./credentials-context";
import { RouterProvider, router } from "./router";
import { WorkspaceProvider } from "./workspace-context";

/**
 * The top-level app shell. The entry point (`src/main.tsx`) renders
 * this directly. Renders the provider tree, mounts the router.
 */
export function App(): ReactNode {
  return (
    <StrictMode>
      <CredentialsProvider>
        <WorkspaceProvider>
          <RouterProvider router={router} />
        </WorkspaceProvider>
      </CredentialsProvider>
    </StrictMode>
  );
}
