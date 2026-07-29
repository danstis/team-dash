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
import {
  WORKSPACES_URL,
  authenticatedUserHandler,
  invalidUserTokenHandler,
  userNetworkErrorHandler,
  workspacePermissionFailureHandler,
} from "../../../fixtures/asana-auth-handlers";
import { server } from "../../../setup";

const TOKEN = "fixture-token-123456789";
const WORKSPACES = [
  {
    gid: "workspace-1",
    name: "Design Systems",
    resource_type: "workspace" as const,
  },
] as const;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderAndFill(onValidated?: (validated: unknown) => void) {
  render(<TokenEntryForm onValidated={onValidated} />);

  const tokenInput = screen.getByLabelText(/^token$/i) as HTMLInputElement;
  fireEvent.change(tokenInput, { target: { value: TOKEN } });

  return {
    tokenInput,
    testButton: screen.getByRole("button", { name: /test token/i }),
  };
}

async function submitForOutcome(handlers: Parameters<typeof server.use>) {
  server.use(...handlers);

  const form = renderAndFill();
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
    const onValidated = vi.fn();

    server.use(
      authenticatedUserHandler(),
      http.get(WORKSPACES_URL, () => {
        workspaceRequests += 1;
        return workspacesPending;
      }),
    );

    const { tokenInput, testButton } = renderAndFill(onValidated);
    fireEvent.click(testButton);

    await waitFor(() => expect(workspaceRequests).toBe(1));
    await waitFor(() => expect(testButton).toBeDisabled());
    expect(testButton).toHaveAttribute("aria-busy", "true");
    expect(tokenInput).toBeDisabled();

    resolveWorkspaces(HttpResponse.json({ data: WORKSPACES, next_page: null }));

    await waitFor(() =>
      expect(onValidated).toHaveBeenCalledWith({
        token: TOKEN,
        maskedIdentifier: "6789",
        workspaces: WORKSPACES,
      }),
    );

    expect(tokenInput).toHaveValue("");
    expect(
      screen.getByText(/found 1 workspace accessible to this token/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Design Systems")).toBeInTheDocument();
  });

  it.each([
    {
      name: "invalid-token",
      handlers: [invalidUserTokenHandler()],
      expected: /invalid token\. asana rejected the credential\./i,
    },
    {
      name: "network-error",
      handlers: [userNetworkErrorHandler()],
      expected: /network error:/i,
      assertScrubbed: true,
    },
    {
      name: "workspace permission failure",
      handlers: [
        authenticatedUserHandler(),
        workspacePermissionFailureHandler(),
      ],
      expected: /insufficient permission to list workspaces/i,
      assertTokenRetained: true,
    },
  ])(
    "renders the $name outcome",
    async ({ handlers, expected, assertScrubbed, assertTokenRetained }) => {
      const { outcome, tokenInput } = await submitForOutcome(handlers);

      expect(outcome).toHaveTextContent(expected);

      if (assertScrubbed) {
        expect(outcome).not.toHaveTextContent(TOKEN);
      }

      if (assertTokenRetained) {
        expect(tokenInput).toHaveValue(TOKEN);
        expect(
          screen.queryByTestId("token-entry-validated"),
        ).not.toBeInTheDocument();
      }
    },
  );
});
