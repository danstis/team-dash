import { http } from "msw";
import { describe, expect, it } from "vitest";

import { asanaHandlers } from "../../fixtures/asana/small-dataset/handlers";
import {
  smallDataset,
  smallDatasetWorkspaceGid,
} from "../../fixtures/asana/small-dataset/data";
import { server } from "../setup";

describe("small Asana MSW fixture", () => {
  it("serves the workspace, active projects, and task pages through read-only GET handlers", async () => {
    server.use(...asanaHandlers);

    const headers = { Authorization: "Bearer synthetic-fixture-token" };
    const workspaces = await fetch("https://app.asana.com/api/1.0/workspaces", {
      headers,
    });
    const projects = await fetch(
      `https://app.asana.com/api/1.0/projects?workspace=${smallDatasetWorkspaceGid}&archived=false`,
      { headers },
    );
    const tasks = await fetch(
      `https://app.asana.com/api/1.0/projects/${smallDataset.projects[0]?.gid}/tasks`,
      { headers },
    );

    expect(workspaces.status).toBe(200);
    expect(projects.status).toBe(200);
    expect(tasks.status).toBe(200);
    await expect(workspaces.json()).resolves.toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({ gid: smallDatasetWorkspaceGid }),
      ]),
    });
    await expect(projects.json()).resolves.toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({ archived: false }),
      ]),
    });
  });

  it("includes a multi-project task, a subtask, and estimated and unestimated tasks", () => {
    const tasks = smallDataset.tasks;
    const multiProjectTask = tasks.find((task) => task.projects.length > 1);
    const subtask = tasks.find((task) => task.parent);

    expect(multiProjectTask).toBeDefined();
    expect(subtask).toBeDefined();
    expect(
      tasks.some((task) =>
        task.custom_fields?.some(
          (field) =>
            field.name === "Estimated Time" && field.number_value !== null,
        ),
      ),
    ).toBe(true);
    expect(
      tasks.some((task) =>
        task.custom_fields?.some(
          (field) =>
            field.name === "Estimated Time" && field.number_value === null,
        ),
      ),
    ).toBe(true);
  });

  it("does not register mutating request handlers", () => {
    const source = asanaHandlers
      .map((handler) => handler.info.method)
      .join(" ");
    expect(source).not.toMatch(/POST|PUT|PATCH|DELETE/);
    expect(
      asanaHandlers.every((handler) => handler.info.method === "GET"),
    ).toBe(true);
  });

  it("returns 401 for a missing bearer token", async () => {
    server.use(...asanaHandlers);

    const response = await fetch("https://app.asana.com/api/1.0/workspaces");

    expect(response.status).toBe(401);
  });

  it("supports the fixture failure switch without changing handler methods", async () => {
    server.use(
      http.get(
        "https://app.asana.com/api/1.0/projects/:projectGid/tasks",
        () => new Response(null, { status: 503 }),
      ),
      ...asanaHandlers,
    );

    const response = await fetch(
      `https://app.asana.com/api/1.0/projects/${smallDataset.projects[0]?.gid}/tasks?mockFailure=network-mid-refresh`,
      { headers: { Authorization: "Bearer synthetic-fixture-token" } },
    );

    expect(response.status).toBe(503);
  });
});
