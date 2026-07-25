import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { listWorkspaces, testToken } from "../../src/data/asana/client";
import { server } from "../setup";

const token = "fixture-token";

const expectOutcome = async (
  request: () => Promise<{ outcome: string }>,
  outcome: string,
) => {
  await expect(request()).resolves.toMatchObject({ outcome });
};

describe("Asana credential client contract", () => {
  describe("testToken", () => {
    it("returns the authenticated user on success", async () => {
      const result = await testToken(token);

      expect(result).toMatchObject({
        outcome: "ok",
        data: {
          gid: expect.any(String),
          name: expect.any(String),
          resource_type: "user",
        },
      });
    });

    it("maps an invalid token to auth_failure", async () => {
      server.use(
        http.get(
          "https://app.asana.com/api/1.0/users/me",
          () => new HttpResponse(null, { status: 401 }),
        ),
      );

      await expectOutcome(() => testToken(token), "auth_failure");
    });

    it("maps a network failure without throwing or exposing the token", async () => {
      server.use(
        http.get("https://app.asana.com/api/1.0/users/me", () =>
          HttpResponse.error(),
        ),
      );

      const result = await testToken(token);

      expect(result.outcome).toBe("network_error");
      if (result.outcome === "network_error") {
        expect(result.message).not.toContain(token);
      }
    });

    it("maps insufficient permission to permission_failure", async () => {
      server.use(
        http.get(
          "https://app.asana.com/api/1.0/users/me",
          () => new HttpResponse(null, { status: 403 }),
        ),
      );

      await expectOutcome(() => testToken(token), "permission_failure");
    });
  });

  describe("listWorkspaces", () => {
    it("returns accessible workspaces on success", async () => {
      const result = await listWorkspaces(token);

      expect(result).toMatchObject({
        outcome: "ok",
        data: {
          data: expect.arrayContaining([
            expect.objectContaining({
              gid: expect.any(String),
              name: expect.any(String),
              resource_type: "workspace",
            }),
          ]),
          next_page: null,
        },
      });
    });

    it("maps invalid token to auth_failure", async () => {
      server.use(
        http.get(
          "https://app.asana.com/api/1.0/workspaces",
          () => new HttpResponse(null, { status: 401 }),
        ),
      );

      await expectOutcome(() => listWorkspaces(token), "auth_failure");
    });

    it("maps a network failure without throwing", async () => {
      server.use(
        http.get("https://app.asana.com/api/1.0/workspaces", () =>
          HttpResponse.error(),
        ),
      );

      await expectOutcome(() => listWorkspaces(token), "network_error");
    });

    it("maps insufficient permission to permission_failure", async () => {
      server.use(
        http.get(
          "https://app.asana.com/api/1.0/workspaces",
          () => new HttpResponse(null, { status: 403 }),
        ),
      );

      await expectOutcome(() => listWorkspaces(token), "permission_failure");
    });
  });
});
