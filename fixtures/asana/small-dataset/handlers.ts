import { http, HttpResponse } from "msw";

import { smallDataset, smallDatasetWorkspaceGid } from "./data";

const API_BASE = "https://app.asana.com/api/1.0";

function authorised(request: Request): Response | null {
  if (!request.headers.get("Authorization")?.startsWith("Bearer ")) {
    return HttpResponse.json(
      { errors: [{ message: "Not Authorized" }] },
      { status: 401 },
    );
  }
  return null;
}

function page<T>(data: readonly T[]) {
  return { data, next_page: null };
}

export const asanaHandlers = [
  http.get(`${API_BASE}/users/me`, ({ request }) => {
    const failure = authorised(request);
    if (failure) return failure;
    return HttpResponse.json({
      gid: smallDataset.users[0].gid,
      name: smallDataset.users[0].name,
      email: smallDataset.users[0].email,
      resource_type: "user",
    });
  }),
  http.get(`${API_BASE}/workspaces`, ({ request }) => {
    const failure = authorised(request);
    if (failure) return failure;
    return HttpResponse.json(page(smallDataset.workspaces));
  }),
  http.get(`${API_BASE}/projects`, ({ request }) => {
    const failure = authorised(request);
    if (failure) return failure;
    const url = new URL(request.url);
    const workspace = url.searchParams.get("workspace");
    const archived = url.searchParams.get("archived");
    const projects = smallDataset.projects.filter(
      (project) =>
        (workspace === null || project.workspace?.gid === workspace) &&
        (archived !== "false" || !project.archived),
    );
    return HttpResponse.json(page(projects));
  }),
  http.get(`${API_BASE}/projects/:projectGid`, ({ request, params }) => {
    const failure = authorised(request);
    if (failure) return failure;
    const project = smallDataset.projects.find(
      (item) => item.gid === params.projectGid,
    );
    return project === undefined
      ? HttpResponse.json(
          { errors: [{ message: "Not Found" }] },
          { status: 404 },
        )
      : HttpResponse.json(project);
  }),
  http.get(`${API_BASE}/projects/:projectGid/tasks`, ({ request, params }) => {
    const failure = authorised(request);
    if (failure) return failure;
    const url = new URL(request.url);
    if (url.searchParams.get("mockFailure") === "network-mid-refresh") {
      return new Response(null, { status: 503 });
    }
    const tasks = smallDataset.tasks.filter(
      (task) =>
        task.projects.some((project) => project.gid === params.projectGid) ||
        (task.parent !== null &&
          task.parent.gid === smallDataset.tasks[0].gid &&
          params.projectGid === smallDataset.projects[0].gid),
    );
    return HttpResponse.json(page(tasks));
  }),
  http.get(`${API_BASE}/tasks/:taskGid`, ({ request, params }) => {
    const failure = authorised(request);
    if (failure) return failure;
    const task = smallDataset.tasks.find((item) => item.gid === params.taskGid);
    return task === undefined
      ? HttpResponse.json(
          { errors: [{ message: "Not Found" }] },
          { status: 404 },
        )
      : HttpResponse.json(task);
  }),
  http.get(`${API_BASE}/tasks/:taskGid/subtasks`, ({ request, params }) => {
    const failure = authorised(request);
    if (failure) return failure;
    return HttpResponse.json(
      page(
        smallDataset.tasks.filter(
          (task) => task.parent?.gid === params.taskGid,
        ),
      ),
    );
  }),
  http.get(`${API_BASE}/portfolios`, ({ request }) => {
    const failure = authorised(request);
    if (failure) return failure;
    const workspace = new URL(request.url).searchParams.get("workspace");
    return HttpResponse.json(
      page(
        smallDataset.portfolios.filter(
          (portfolio) => portfolio.workspace?.gid === workspace,
        ),
      ),
    );
  }),
  http.get(
    `${API_BASE}/portfolios/:portfolioGid/items`,
    ({ request, params }) => {
      const failure = authorised(request);
      if (failure) return failure;
      if (params.portfolioGid !== smallDataset.portfolios[0].gid)
        return HttpResponse.json(page([]));
      return HttpResponse.json(
        page(
          smallDataset.projects
            .slice(0, 2)
            .map(({ gid, name }) => ({ gid, name, resource_type: "project" })),
        ),
      );
    },
  ),
  http.get(`${API_BASE}/teams`, ({ request }) => {
    const failure = authorised(request);
    if (failure) return failure;
    return HttpResponse.json(page(smallDataset.teams));
  }),
  http.get(`${API_BASE}/users`, ({ request }) => {
    const failure = authorised(request);
    if (failure) return failure;
    return HttpResponse.json(page(smallDataset.users));
  }),
  http.get(
    `${API_BASE}/projects/:projectGid/sections`,
    ({ request, params }) => {
      const failure = authorised(request);
      if (failure) return failure;
      return HttpResponse.json(
        page([
          {
            gid: `section-${params.projectGid}`,
            name: "In progress",
            resource_type: "section",
            project: { gid: String(params.projectGid) },
          },
        ]),
      );
    },
  ),
  http.get(`${API_BASE}/tasks/:taskGid/dependencies`, ({ request }) => {
    const failure = authorised(request);
    if (failure) return failure;
    return HttpResponse.json(page([]));
  }),
  http.get(`${API_BASE}/events`, ({ request }) => {
    const failure = authorised(request);
    if (failure) return failure;
    return HttpResponse.json({ data: [], sync: "fixture-sync-token" });
  }),
];

export { smallDatasetWorkspaceGid };
