import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TokenEntryForm } from "../../../../src/features/credentials/TokenEntry";
import { server } from "../../../setup";

const TOKEN = "fixture-token-123456789";

const WORKSPACES = [
  {
    gid: "workspace-1",
    name: "Design Systems",
    resource_type: "workspace" as const,
  },
  {
    gid: "workspace-2",
    name: "Operations",
    resource_type: "workspace" as const,
  },
] as const;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function enterToken(token: string): HTMLInputElement {
  const input = screen.getByLabelText(/^token$/i);
  fireEvent.change(input, { target: { value: token } });
  return input;
}

describe("TokenEntryForm", () => {
  it("lists workspaces after a successful validation, clears the input, and reports the masked identifier", async () => {
    let workspaceRequests = 0;
    let resolveWorkspaces: ((response: HttpResponse) => void) | null = null;
    const workspacesPending = new Promise<HttpResponse>((resolve) => {
      resolveWorkspaces = resolve;
    });

    server.use(
      http.get("https://app.asana.com/api/1.0/users/me", () =>
        HttpResponse.json({
          gid: "user-1",
          name: "Alex Kim",
          resource_type: "user",
        }),
      ),
      http.get("https://app.asana.com/api/1.0/workspaces", () => {
        workspaceRequests += 1;
        return workspacesPending;
      }),
    );

    const onValidated = vi.fn();
    render(<TokenEntryForm onValidated={onValidated} />);

    const tokenInput = enterToken(TOKEN);
    const testButton = screen.getByRole("button", { name: /test token/i });

    fireEvent.click(testButton);

    await waitFor(() => expect(workspaceRequests).toBe(1));
    await waitFor(() => expect(testButton).toBeDisabled());
    expect(testButton).toHaveAttribute("aria-busy", "true");
    expect(tokenInput).toBeDisabled();

    resolveWorkspaces?.(
      HttpResponse.json({
        data: WORKSPACES,
        next_page: null,
      }),
    );

    await waitFor(() =>
      expect(onValidated).toHaveBeenCalledWith({
        token: TOKEN,
        maskedIdentifier: "6789",
        workspaces: WORKSPACES,
      }),
    );

    expect(tokenInput).toHaveValue("");
    expect(
      screen.getByText(/found 2 workspaces accessible to this token/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Design Systems")).toBeInTheDocument();
    expect(screen.getByText("Operations")).toBeInTheDocument();
  });

  it("renders the invalid-token outcome when Asana rejects the credential", async () => {
    server.use(
      http.get(
        "https://app.asana.com/api/1.0/users/me",
        () => new HttpResponse(null, { status: 401 }),
      ),
    );

    render(<TokenEntryForm />);

    enterToken(TOKEN);
    fireEvent.click(screen.getByRole("button", { name: /test token/i }));

    await waitFor(() =>
      expect(screen.getByTestId("token-test-outcome")).toHaveTextContent(
        /invalid token\. asana rejected the credential\./i,
      ),
    );
  });

  it("renders the scrubbed network-error outcome when validation cannot reach Asana", async () => {
    server.use(
      http.get("https://app.asana.com/api/1.0/users/me", () =>
        HttpResponse.error(),
      ),
    );

    render(<TokenEntryForm />);

    enterToken(TOKEN);
    fireEvent.click(screen.getByRole("button", { name: /test token/i }));

    await waitFor(() =>
      expect(screen.getByTestId("token-test-outcome")).toHaveTextContent(
        /network error:/i,
      ),
    );
    expect(screen.getByTestId("token-test-outcome")).not.toHaveTextContent(
      TOKEN,
    );
  });

  it("renders the workspace-list permission failure without clearing the draft token", async () => {
    server.use(
      http.get("https://app.asana.com/api/1.0/users/me", () =>
        HttpResponse.json({
          gid: "user-1",
          name: "Alex Kim",
          resource_type: "user",
        }),
      ),
      http.get(
        "https://app.asana.com/api/1.0/workspaces",
        () => new HttpResponse(null, { status: 403 }),
      ),
    );

    render(<TokenEntryForm />);

    const tokenInput = enterToken(TOKEN);
    fireEvent.click(screen.getByRole("button", { name: /test token/i }));

    await waitFor(() =>
      expect(screen.getByTestId("token-test-outcome")).toHaveTextContent(
        /insufficient permission to list workspaces/i,
      ),
    );
    expect(tokenInput).toHaveValue(TOKEN);
    expect(
      screen.queryByTestId("token-entry-validated"),
    ).not.toBeInTheDocument();
  });
});
