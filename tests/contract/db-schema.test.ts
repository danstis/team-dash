import { describe, expect, it } from "vitest";
import { TeamDashDatabase } from "../../src/data/db/schema";

const expectedSchema = {
  workspaces: { primaryKey: "gid", indexes: [] },
  projects: {
    primaryKey: "gid",
    indexes: ["workspaceGid", "asanaTeamGid", "archived"],
  },
  portfolios: { primaryKey: "gid", indexes: ["workspaceGid"] },
  asanaTeams: { primaryKey: "gid", indexes: ["workspaceGid"] },
  teamMappingOverrides: { primaryKey: "projectGid", indexes: [] },
  personGroups: {
    primaryKey: "id",
    indexes: ["workspaceGid", "kind"],
  },
  users: { primaryKey: "gid", indexes: ["workspaceGid"] },
  priorityFields: { primaryKey: "projectGid", indexes: [] },
  dependencies: {
    primaryKey: "[taskGid+dependsOnTaskGid]",
    indexes: ["taskGid"],
  },
  sections: { primaryKey: "gid", indexes: ["projectGid"] },
  tasks: {
    primaryKey: "gid",
    indexes: [
      "*projectGids",
      "assigneeGid",
      "parentTaskGid",
      "completedAt",
      "createdAt",
      "outOfScopeReason",
    ],
  },
  snapshots: {
    primaryKey: "[workspaceGid+localCalendarDate]",
    indexes: [],
  },
  refreshSessions: {
    primaryKey: "id",
    indexes: ["workspaceGid", "status", "startedAt"],
  },
  credentials: { primaryKey: "mode", indexes: [] },
} as const;

describe("T022 live Dexie schema contract", () => {
  it("matches contracts/storage-repository.md version 1 store and index definitions", () => {
    const database = new TeamDashDatabase("team-dash-schema-contract");
    const liveSchema = Object.fromEntries(
      database.tables.map((table) => [
        table.name,
        {
          primaryKey: table.schema.primKey.src,
          indexes: table.schema.indexes.map((index) => index.src),
        },
      ]),
    );

    expect(database.verno).toBe(1);
    expect(liveSchema).toEqual(expectedSchema);
  });
});
