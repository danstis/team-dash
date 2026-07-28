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
const USERS_ME_URL = "https://app.asana.com/api/1.0/users/me";
const WORKSPACES_URL = "https://app.asana.com/api/1.0/workspaces";
const AUTHENTICATED_USER = {
  gid: "user-1",
  name: "Alex Kim",
  resource_type: "user" as const,
};

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
  const input = screen.getByLabelText(/^token$/i) as HTMLInputElement;
  fireEvent.change(input, { target: { value: token } });
  return input;
}

function renderForm() {
  render(<TokenEntryForm />);

  return {
    tokenInput: enterToken(TOKEN),
    testButton: screen.getByRole("button", { name: /test token/i }),
  };
}

function mockAuthenticatedUser() {
  return http.get(USERS_ME_URL, () => HttpResponse.json(AUTHENTICATED_USER));
}

async function submitForOutcome() {
  const form = renderForm();
  fireEvent.click(form.testButton);

  return {
    ...form,
    outcome: await screen.findByRole("status"),
  };
}

describe("TokenEntryForm", () => {
  it("lists workspaces after a successful validation, clears the input, and reports the masked identifier", async () => {
    let workspaceRequests = 0;
    let resolveWorkspaces: (response: Response) => void = () => {
      throw new Error("workspace resolver was not initialised");
    };
    const workspacesPending = new Promise<Response>((resolve) => {
      resolveWorkspaces = resolve;
    });

    server.use(
      mockAuthenticatedUser(),
      http.get(WORKSPACES_URL, () => {
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

    resolveWorkspaces(
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
      http.get(USERS_ME_URL, () => new HttpResponse(null, { status: 401 })),
    );

    const { outcome } = await submitForOutcome();

    expect(outcome).toHaveTextContent(
      /invalid token\. asana rejected the credential\./i,
    );
  });

  it("renders the scrubbed network-error outcome when validation cannot reach Asana", async () => {
    server.use(http.get(USERS_ME_URL, () => HttpResponse.error()));

    const { outcome } = await submitForOutcome();

    expect(outcome).toHaveTextContent(/network error:/i);
    expect(outcome).not.toHaveTextContent(TOKEN);
  });

  it("renders the workspace-list permission failure without clearing the draft token", async () => {
    server.use(
      mockAuthenticatedUser(),
      http.get(WORKSPACES_URL, () => new HttpResponse(null, { status: 403 })),
    );

    const { outcome, tokenInput } = await submitForOutcome();

    expect(outcome).toHaveTextContent(
      /insufficient permission to list workspaces/i,
    );
    expect(tokenInput).toHaveValue(TOKEN);
    expect(
      screen.queryByTestId("token-entry-validated"),
    ).not.toBeInTheDocument();
  });
});
