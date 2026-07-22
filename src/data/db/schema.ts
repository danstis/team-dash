import Dexie, { type EntityTable, type Table } from "dexie";

export interface Workspace {
  gid: string;
  name: string;
  selectedAt: string;
}

export interface Project {
  gid: string;
  name: string;
  workspaceGid: string;
  asanaTeamGid: string | null;
  portfolioGids: string[];
  archived: boolean;
}

export interface Portfolio {
  gid: string;
  name: string;
  workspaceGid: string;
  projectGids: string[];
}

export interface AsanaTeam {
  gid: string;
  name: string;
  workspaceGid: string;
}

export interface TeamMappingOverride {
  projectGid: string;
  reportingTeamGid: string;
  updatedAt: string;
}

export interface PersonGroup {
  id: string;
  workspaceGid: string;
  name: string | null;
  kind: "adhoc" | "named";
  memberUserGids: string[];
  createdAt: string;
  updatedAt: string;
}

export interface User {
  gid: string;
  name: string;
  email: string | null;
  workspaceGid: string;
}

export interface PriorityField {
  projectGid: string;
  expectedOptionIds: string[] | null;
  status: "ok" | "missing" | "malformed";
}

export interface Dependency {
  taskGid: string;
  dependsOnTaskGid: string;
  dependsOnTaskAccessible: boolean;
}

export interface Section {
  gid: string;
  projectGid: string;
  name: string;
}

export interface Task {
  gid: string;
  name: string;
  assigneeGid: string | null;
  projectGids: string[];
  parentTaskGid: string | null;
  resourceSubtype: "default_task" | "milestone" | "approval";
  createdAt: string;
  modifiedAt: string;
  completedAt: string | null;
  dueAt: string | null;
  priorityOptionId: string | null;
  estimatedMinutes: number | null;
  actualMinutes: number | null | "unavailable";
  dependsOnTaskGids: string[];
  lastSeenInScopeAt: string;
  outOfScopeReason:
    "deleted" | "project_archived" | "removed_from_projects" | null;
}

export interface Snapshot {
  workspaceGid: string;
  localCalendarDate: string;
  incompleteCount: number;
  incompleteEstimatedMinutes: number;
  unestimatedIncompleteCount: number;
  computedFromRefreshId: string;
  computedAt: string;
}

export interface RefreshSession {
  id: string;
  workspaceGid: string;
  startedAt: string;
  finishedAt: string | null;
  status:
    | "running"
    | "succeeded"
    | "partial_failure"
    | "cancelled"
    | "auth_failure"
    | "permission_failure"
    | "rate_limited";
  itemsRetrieved: number;
  errorDetail: string | null;
  syncMode: "full" | "incremental";
}

export interface EncryptedTokenRecord {
  ciphertext: ArrayBuffer;
  iv: ArrayBuffer;
  keyRef: CryptoKey;
}

export interface CredentialRecord {
  mode: "persistent";
  encryptedTokenRecord: EncryptedTokenRecord;
  maskedIdentifier: string;
  lastValidatedAt: string | null;
  lastValidationResult:
    "valid" | "invalid" | "network_error" | "insufficient_permission" | null;
}

export class TeamDashDatabase extends Dexie {
  workspaces!: EntityTable<Workspace, "gid">;
  projects!: EntityTable<Project, "gid">;
  portfolios!: EntityTable<Portfolio, "gid">;
  asanaTeams!: EntityTable<AsanaTeam, "gid">;
  teamMappingOverrides!: EntityTable<TeamMappingOverride, "projectGid">;
  personGroups!: EntityTable<PersonGroup, "id">;
  users!: EntityTable<User, "gid">;
  priorityFields!: EntityTable<PriorityField, "projectGid">;
  dependencies!: Table<Dependency, [string, string]>;
  sections!: EntityTable<Section, "gid">;
  tasks!: EntityTable<Task, "gid">;
  snapshots!: Table<Snapshot, [string, string]>;
  refreshSessions!: EntityTable<RefreshSession, "id">;
  credentials!: EntityTable<CredentialRecord, "mode">;

  constructor(name = "team-dash") {
    super(name);

    this.version(1).stores({
      workspaces: "gid",
      projects: "gid, workspaceGid, asanaTeamGid, archived",
      portfolios: "gid, workspaceGid",
      asanaTeams: "gid, workspaceGid",
      teamMappingOverrides: "projectGid",
      personGroups: "id, workspaceGid, kind",
      users: "gid, workspaceGid",
      priorityFields: "projectGid",
      dependencies: "[taskGid+dependsOnTaskGid], taskGid",
      sections: "gid, projectGid",
      tasks:
        "gid, *projectGids, assigneeGid, parentTaskGid, completedAt, createdAt, outOfScopeReason",
      snapshots: "[workspaceGid+localCalendarDate]",
      refreshSessions: "id, workspaceGid, status, startedAt",
      credentials: "mode",
    });
  }
}

export const db = new TeamDashDatabase();
