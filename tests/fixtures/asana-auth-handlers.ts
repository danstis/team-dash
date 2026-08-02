import { http, HttpResponse } from "msw";

export const USERS_ME_URL = "https://app.asana.com/api/1.0/users/me";
export const WORKSPACES_URL = "https://app.asana.com/api/1.0/workspaces";
export const AUTHENTICATED_USER = {
  gid: "user-1",
  name: "Alex Kim",
  resource_type: "user" as const,
};

export function authenticatedUserHandler() {
  return http.get(USERS_ME_URL, () =>
    HttpResponse.json({ data: AUTHENTICATED_USER }),
  );
}

export function invalidUserTokenHandler() {
  return http.get(USERS_ME_URL, () => new HttpResponse(null, { status: 401 }));
}

export function userPermissionFailureHandler() {
  return http.get(USERS_ME_URL, () => new HttpResponse(null, { status: 403 }));
}

export function userNetworkErrorHandler() {
  return http.get(USERS_ME_URL, () => HttpResponse.error());
}

export function workspacePermissionFailureHandler() {
  return http.get(
    WORKSPACES_URL,
    () => new HttpResponse(null, { status: 403 }),
  );
}
