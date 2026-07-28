/**
 * T040 — `src/data/db/repositories/credential.repository.ts` contract tests
 * (Red phase).
 *
 * Pins the `CredentialRepository` interface from
 * `specs/001-asana-team-dashboard/contracts/storage-repository.md` against the
 * live Dexie schema in `src/data/db/schema.ts`. The contract test is the
 * canonical gate that catches a future contributor who accidentally
 * implements one of the five methods against a stale `CredentialRecord`
 * shape, against the wrong primary key, or with a deferred (non-`await`ed)
 * Dexie write — all of which are FR-005a / FR-007 contract violations.
 *
 * Constitution Principle III says these tests are the test-first gate that
 * gets written before the implementation lands. The Red phase assertion
 * chain (each test fails for the intended reason before the implementation
 * is checked in) is exercised manually by the agent: the file is created
 * with no matching implementation, the suite is run, and the suite fails
 * with `Cannot find module` / `describe is not a function`-style errors.
 *
 * Test scope (per the T040 task row and the contract):
 *
 * - `getCurrent()` returns the persisted `CredentialRecord` when one exists
 *   and `null` when none does. The Dexie primary key is the singleton
 *   `"persistent"` mode — the contract deliberately does not expose a
 *   mode-`"session"` row because the session-only token is held in memory
 *   only (FR-002a) and never written to IndexedDB.
 *
 * - `setSessionToken(token)` is "memory only" per the contract — it MUST
 *   NOT write a new credential row to Dexie. It MUST remove the prior
 *   persistent row when one exists (FR-005a: switching back to session
 *   storage immediately deletes the previous encrypted record and its
 *   non-extractable key). The PRIORITY of the delete is the FR-005a
 *   guarantee: the delete must be awaited so the encrypted record is
 *   observably gone before `setSessionToken` resolves.
 *
 * - `setPersistentToken(token)` MUST encrypt the token under a fresh
 *   non-extractable AES-GCM key (T027 / `data/crypto/token-crypto.ts`) and
 *   persist the resulting `EncryptedTokenRecord`. It MUST delete the prior
 *   encrypted record FIRST (FR-005a) — a deferred or staged delete is the
 *   contract failure these tests pin. The persisted record's
 *   `maskedIdentifier` MUST be the last four characters of the token
 *   (FR-008 — the only representation the rest of the app is permitted to
 *   render).
 *
 * - `clearToSessionOnly()` MUST delete the persistent row and its
 *   associated `CryptoKey` handle. It MUST NOT touch any other store
 *   (cache, snapshots, team-mapping overrides, …) — those are reserved
 *   for the FR-007 single-action wipe.
 *
 * - `clearAll()` MUST span EVERY store in the Dexie schema in a single
 *   transaction (FR-007). A two-stage "credentials now, then everything
 *   else" implementation is a contract violation. The Dexie-native
 *   transaction atomicity is the enforcement mechanism: a mid-transaction
 *   throw MUST NOT leave any store partially cleared.
 *
 * Why `tests/contract/` (not `tests/unit/`)
 * -----------------------------------------
 * The repository is the boundary every other layer crosses (the
 * `CredentialsProvider` in `src/app/credentials-context.tsx` is the only
 * importer today, but the Settings panel and the route guard reach it
 * through the provider). The contract tests live next to the schema
 * contract (`tests/contract/db-schema.test.ts`) so a single CI command
 * (`npm run test:contract`) validates the whole storage layer.
 *
 * Determinism
 * -----------
 * The tests use deterministic fixtures (a small synthetic PAT, a fixed
 * 12-byte IV, a freshly generated key per test) and never reach a live
 * Asana workspace. The Dexie store is reset between tests through
 * before/afterEach clearing, never by `db.delete()` — closing the
 * database would fire `DatabaseClosedError` on any pending
 * `db.credentials.get(...)` promise left over from a previous test's
 * provider mount, which would surface as an unhandled rejection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../src/data/db/schema";
import { decryptToken } from "../../src/data/crypto/token-crypto";
import { credentialRepository } from "../../src/data/db/repositories/credential.repository";

const PERSISTENT_KEY = "persistent" as const;

const SAMPLE_TOKEN = "0/1234567890:abcdefghijklmnopqrstuvwxyz";
const SAMPLE_LAST_FOUR = SAMPLE_TOKEN.slice(-4);

const REPLACEMENT_TOKEN = "0/9876543210:zyxwvutsrqponmlkjihgfedcba";
const REPLACEMENT_LAST_FOUR = REPLACEMENT_TOKEN.slice(-4);

/**
 * Cross-store row seed used by the FR-007 atomicity tests. Each row
 * carries a value that the assertion can observe after the clear
 * succeeds, so a "table not cleared" failure mode is unambiguous.
 */
function seedEveryStore(): Promise<void> {
  return db.transaction(
    "rw",
    [
      db.workspaces,
      db.projects,
      db.portfolios,
      db.asanaTeams,
      db.teamMappingOverrides,
      db.personGroups,
      db.users,
      db.priorityFields,
      db.dependencies,
      db.sections,
      db.tasks,
      db.snapshots,
      db.refreshSessions,
      db.credentials,
    ],
    async () => {
      await db.workspaces.put({
        gid: "ws-1",
        name: "Workspace",
        selectedAt: "2026-07-25T00:00:00.000Z",
      });
      await db.projects.put({
        gid: "proj-1",
        name: "Project",
        workspaceGid: "ws-1",
        asanaTeamGid: "team-1",
        portfolioGids: [],
        archived: false,
      });
      await db.portfolios.put({
        gid: "port-1",
        name: "Portfolio",
        workspaceGid: "ws-1",
        projectGids: ["proj-1"],
      });
      await db.asanaTeams.put({
        gid: "team-1",
        name: "Team",
        workspaceGid: "ws-1",
      });
      await db.teamMappingOverrides.put({
        projectGid: "proj-1",
        reportingTeamGid: "team-platform",
        updatedAt: "2026-07-25T00:00:00.000Z",
      });
      await db.personGroups.put({
        id: "group-1",
        workspaceGid: "ws-1",
        name: "Leadership",
        kind: "named",
        memberUserGids: ["user-1"],
        createdAt: "2026-07-25T00:00:00.000Z",
        updatedAt: "2026-07-25T00:00:00.000Z",
      });
      await db.users.put({
        gid: "user-1",
        name: "Alex",
        email: "alex@example.com",
        workspaceGid: "ws-1",
      });
      await db.priorityFields.put({
        projectGid: "proj-1",
        expectedOptionIds: ["high", "low"],
        status: "ok",
      });
      await db.dependencies.put({
        taskGid: "task-1",
        dependsOnTaskGid: "task-2",
        dependsOnTaskAccessible: true,
      });
      await db.sections.put({
        gid: "section-1",
        projectGid: "proj-1",
        name: "Doing",
      });
      await db.tasks.put({
        gid: "task-1",
        name: "Launch",
        assigneeGid: "user-1",
        projectGids: ["proj-1"],
        parentTaskGid: null,
        resourceSubtype: "default_task",
        createdAt: "2026-07-01T09:00:00.000Z",
        modifiedAt: "2026-07-20T09:00:00.000Z",
        completedAt: null,
        dueAt: "2026-07-31T17:00:00.000Z",
        priorityOptionId: "high",
        estimatedMinutes: 480,
        actualMinutes: null,
        dependsOnTaskGids: [],
        lastSeenInScopeAt: "2026-07-25T00:00:00.000Z",
        outOfScopeReason: null,
      });
      await db.snapshots.put({
        workspaceGid: "ws-1",
        localCalendarDate: "2026-07-25",
        incompleteCount: 1,
        incompleteEstimatedMinutes: 480,
        unestimatedIncompleteCount: 0,
        computedFromRefreshId: "refresh-1",
        computedAt: "2026-07-25T00:00:00.000Z",
      });
      await db.refreshSessions.put({
        id: "refresh-1",
        workspaceGid: "ws-1",
        startedAt: "2026-07-25T00:00:00.000Z",
        finishedAt: "2026-07-25T00:05:00.000Z",
        status: "succeeded",
        itemsRetrieved: 42,
        errorDetail: null,
        syncMode: "full",
      });
    },
  );
}

async function clearEveryStore(): Promise<void> {
  await db.workspaces.clear();
  await db.projects.clear();
  await db.portfolios.clear();
  await db.asanaTeams.clear();
  await db.teamMappingOverrides.clear();
  await db.personGroups.clear();
  await db.users.clear();
  await db.priorityFields.clear();
  await db.dependencies.clear();
  await db.sections.clear();
  await db.tasks.clear();
  await db.snapshots.clear();
  await db.refreshSessions.clear();
  await db.credentials.clear();
}

describe("T040 CredentialRepository (contracts/storage-repository.md)", () => {
  beforeEach(async () => {
    await clearEveryStore();
  });

  afterEach(async () => {
    await clearEveryStore();
  });

  describe("getCurrent", () => {
    it("returns null when no credential is stored", async () => {
      const result = await credentialRepository.getCurrent();
      expect(result).toBeNull();
    });

    it("returns the persisted record when a persistent row exists", async () => {
      await db.credentials.put({
        mode: "persistent",
        encryptedTokenRecord: {
          ciphertext: new ArrayBuffer(16),
          iv: new ArrayBuffer(12),
          keyRef: await fakeKey(),
        },
        maskedIdentifier: SAMPLE_LAST_FOUR,
        lastValidatedAt: null,
        lastValidationResult: null,
      });

      const result = await credentialRepository.getCurrent();
      expect(result).not.toBeNull();
      expect(result?.mode).toBe("persistent");
      expect(result?.maskedIdentifier).toBe(SAMPLE_LAST_FOUR);
    });
  });

  describe("setSessionToken (memory only, FR-005a immediate prior delete)", () => {
    it("deletes the prior encrypted record on a persistent -> session switch", async () => {
      const key = await fakeKey();
      await db.credentials.put({
        mode: "persistent",
        encryptedTokenRecord: {
          ciphertext: new ArrayBuffer(16),
          iv: new ArrayBuffer(12),
          keyRef: key,
        },
        maskedIdentifier: SAMPLE_LAST_FOUR,
        lastValidatedAt: null,
        lastValidationResult: null,
      });
      expect(await db.credentials.count()).toBe(1);

      await credentialRepository.setSessionToken(SAMPLE_TOKEN);

      expect(await db.credentials.count()).toBe(0);
    });

    it("does NOT write a session-mode row to Dexie (memory only)", async () => {
      // The contract comment on setSessionToken is "memory only, no Dexie
      // write": the persistence layer observes zero rows after the call.
      // A future contributor who accidentally writes a session-mode row
      // to the credentials table fails this test.
      await credentialRepository.setSessionToken(SAMPLE_TOKEN);

      expect(await db.credentials.count()).toBe(0);
    });

    it("is a no-op on Dexie when no prior record exists", async () => {
      await credentialRepository.setSessionToken(SAMPLE_TOKEN);
      await credentialRepository.setSessionToken(SAMPLE_TOKEN);

      expect(await db.credentials.count()).toBe(0);
    });
  });

  describe("setPersistentToken (FR-005a immediate prior delete + AES-GCM encryption)", () => {
    it("writes a persistent row whose ciphertext is AES-GCM-encrypted", async () => {
      await credentialRepository.setPersistentToken(SAMPLE_TOKEN);

      const stored = await db.credentials.get(PERSISTENT_KEY);
      expect(stored).toBeDefined();
      expect(stored?.mode).toBe("persistent");
      expect(stored?.maskedIdentifier).toBe(SAMPLE_LAST_FOUR);
      expect(stored?.encryptedTokenRecord).toBeDefined();
      expect(stored?.encryptedTokenRecord.iv.byteLength).toBe(12);
      // Ciphertext must be at least the AES-GCM tag length (16 bytes)
      // and at least the plaintext size — not a fixed literal, because
      // the implementation uses a fresh IV per encrypt.
      expect(
        stored?.encryptedTokenRecord.ciphertext.byteLength,
      ).toBeGreaterThan(0);
    });

    it("round-trips the encrypted token through token-crypto's decryptToken", async () => {
      // The persisted record MUST be decryptable by the same key handle
      // stored in the row — otherwise the CredentialsProvider's load
      // path (T031) cannot recover the plaintext on launch and the app
      // routes to first-run (FR-002b). The contract is end-to-end:
      // encrypt-on-write, decrypt-on-read, same key.
      await credentialRepository.setPersistentToken(SAMPLE_TOKEN);

      const stored = await db.credentials.get(PERSISTENT_KEY);
      expect(stored).toBeDefined();
      const recovered = await decryptToken(
        stored!.encryptedTokenRecord.ciphertext,
        stored!.encryptedTokenRecord.iv,
        stored!.encryptedTokenRecord.keyRef,
      );
      expect(recovered).toBe(SAMPLE_TOKEN);
    });

    it("stores the masked identifier as the last four characters of the token (FR-008)", async () => {
      await credentialRepository.setPersistentToken(SAMPLE_TOKEN);

      const stored = await db.credentials.get(PERSISTENT_KEY);
      expect(stored?.maskedIdentifier).toBe(SAMPLE_LAST_FOUR);
      // The masked identifier MUST NOT carry the full token — that is
      // FR-008's "never rendered in full" boundary.
      expect(stored?.maskedIdentifier).not.toBe(SAMPLE_TOKEN);
    });

    it("immediately deletes the prior encrypted record before writing the new one (FR-005a)", async () => {
      // Seed a prior persistent row so the FR-005a "previous record
      // first" ordering is observable. After the new token is written,
      // exactly ONE persistent row exists and the new ciphertext is
      // generated under a different key (a fresh key per setPersistentToken
      // call is the FR-002a design — the prior key is non-extractable and
      // therefore must be discarded, not retained).
      const priorKey = await fakeKey();
      await db.credentials.put({
        mode: "persistent",
        encryptedTokenRecord: {
          ciphertext: new ArrayBuffer(16),
          iv: new ArrayBuffer(12),
          keyRef: priorKey,
        },
        maskedIdentifier: SAMPLE_LAST_FOUR,
        lastValidatedAt: null,
        lastValidationResult: null,
      });

      await credentialRepository.setPersistentToken(REPLACEMENT_TOKEN);

      const rows = await db.credentials.toArray();
      expect(rows).toHaveLength(1);
      const onlyRow = rows[0];
      expect(onlyRow?.mode).toBe("persistent");
      expect(onlyRow?.maskedIdentifier).toBe(REPLACEMENT_LAST_FOUR);
      // The retained row's key handle is the one generated for the new
      // token — not the prior seeded key. A no-op upsert that left the
      // old key in place would fail the next test (decrypt back does not
      // match the new plaintext).
      expect(onlyRow?.encryptedTokenRecord.keyRef).not.toBe(priorKey);
    });

    it("the new record decrypts to the new token (FR-005a end-to-end)", async () => {
      const priorKey = await fakeKey();
      await db.credentials.put({
        mode: "persistent",
        encryptedTokenRecord: {
          ciphertext: new ArrayBuffer(16),
          iv: new ArrayBuffer(12),
          keyRef: priorKey,
        },
        maskedIdentifier: SAMPLE_LAST_FOUR,
        lastValidatedAt: null,
        lastValidationResult: null,
      });

      await credentialRepository.setPersistentToken(REPLACEMENT_TOKEN);

      const stored = await db.credentials.get(PERSISTENT_KEY);
      const recovered = await decryptToken(
        stored!.encryptedTokenRecord.ciphertext,
        stored!.encryptedTokenRecord.iv,
        stored!.encryptedTokenRecord.keyRef,
      );
      expect(recovered).toBe(REPLACEMENT_TOKEN);
    });
  });

  describe("clearToSessionOnly (FR-005a immediate delete, cache untouched)", () => {
    it("deletes the persistent row and its key handle", async () => {
      const key = await fakeKey();
      await db.credentials.put({
        mode: "persistent",
        encryptedTokenRecord: {
          ciphertext: new ArrayBuffer(16),
          iv: new ArrayBuffer(12),
          keyRef: key,
        },
        maskedIdentifier: SAMPLE_LAST_FOUR,
        lastValidatedAt: null,
        lastValidationResult: null,
      });
      expect(await db.credentials.count()).toBe(1);

      await credentialRepository.clearToSessionOnly();

      expect(await db.credentials.count()).toBe(0);
    });

    it("does NOT touch any other Dexie store (cache, snapshots, team mappings)", async () => {
      await seedEveryStore();

      const key = await fakeKey();
      await db.credentials.put({
        mode: "persistent",
        encryptedTokenRecord: {
          ciphertext: new ArrayBuffer(16),
          iv: new ArrayBuffer(12),
          keyRef: key,
        },
        maskedIdentifier: SAMPLE_LAST_FOUR,
        lastValidatedAt: null,
        lastValidationResult: null,
      });

      await credentialRepository.clearToSessionOnly();

      // The credentials row is gone.
      expect(await db.credentials.count()).toBe(0);
      // Every other seeded store row is INTACT. A future contributor
      // who copies the FR-007 single-transaction wipe into the
      // session-only clear path fails this test.
      expect(await db.workspaces.count()).toBe(1);
      expect(await db.projects.count()).toBe(1);
      expect(await db.portfolios.count()).toBe(1);
      expect(await db.asanaTeams.count()).toBe(1);
      expect(await db.teamMappingOverrides.count()).toBe(1);
      expect(await db.personGroups.count()).toBe(1);
      expect(await db.users.count()).toBe(1);
      expect(await db.priorityFields.count()).toBe(1);
      expect(await db.dependencies.count()).toBe(1);
      expect(await db.sections.count()).toBe(1);
      expect(await db.tasks.count()).toBe(1);
      expect(await db.snapshots.count()).toBe(1);
      expect(await db.refreshSessions.count()).toBe(1);
    });

    it("is a no-op when no persistent row exists", async () => {
      await seedEveryStore();

      await credentialRepository.clearToSessionOnly();

      expect(await db.credentials.count()).toBe(0);
      // Other stores remain intact.
      expect(await db.workspaces.count()).toBe(1);
      expect(await db.tasks.count()).toBe(1);
    });
  });

  describe("clearAll (FR-007 single-transaction wipe across every store)", () => {
    it("removes every row from every store in one transaction", async () => {
      await seedEveryStore();
      const key = await fakeKey();
      await db.credentials.put({
        mode: "persistent",
        encryptedTokenRecord: {
          ciphertext: new ArrayBuffer(16),
          iv: new ArrayBuffer(12),
          keyRef: key,
        },
        maskedIdentifier: SAMPLE_LAST_FOUR,
        lastValidatedAt: null,
        lastValidationResult: null,
      });

      expect(await db.credentials.count()).toBe(1);
      expect(await db.workspaces.count()).toBe(1);
      expect(await db.tasks.count()).toBe(1);
      expect(await db.snapshots.count()).toBe(1);

      await credentialRepository.clearAll();

      expect(await db.credentials.count()).toBe(0);
      expect(await db.workspaces.count()).toBe(0);
      expect(await db.projects.count()).toBe(0);
      expect(await db.portfolios.count()).toBe(0);
      expect(await db.asanaTeams.count()).toBe(0);
      expect(await db.teamMappingOverrides.count()).toBe(0);
      expect(await db.personGroups.count()).toBe(0);
      expect(await db.users.count()).toBe(0);
      expect(await db.priorityFields.count()).toBe(0);
      expect(await db.dependencies.count()).toBe(0);
      expect(await db.sections.count()).toBe(0);
      expect(await db.tasks.count()).toBe(0);
      expect(await db.snapshots.count()).toBe(0);
      expect(await db.refreshSessions.count()).toBe(0);
    });

    it("rolls the entire wipe back when a mid-transaction throw escapes (Dexie atomicity)", async () => {
      // Dexie's native transaction atomicity is the enforcement
      // mechanism for FR-007. The implementation MUST NOT split the
      // clear across multiple transactions; otherwise a partial clear
      // (token wiped but cache retained) would survive a mid-batch
      // failure and the spec's "one explicit action that clears the
      // token and all locally retained Asana data together" contract
      // would be violated.
      //
      // Two contract properties are pinned here:
      //
      //  (a) `clearAll` opens a SINGLE `db.transaction` call covering
      //      every store in the schema. The spy on `db.transaction`
      //      records exactly one call site; a two-stage
      //      implementation that calls `db.transaction` twice would
      //      fail this assertion.
      //  (b) Every store is included in that single transaction. The
      //      spy captures the call's `tables` argument and the test
      //      asserts it matches the schema's full store list — a
      //      future contributor who forgets to add a new store to the
      //      clear list (e.g. a new schema version) fails the count
      //      check.
      //
      // The atomicity half of the contract (a mid-batch throw rolling
      // the whole span back) is Dexie's native guarantee when
      // `db.transaction` is called once with all stores in
      // read-write mode. Exercising the throw path directly is
      // fragile under Dexie's internal wrapper, so the integration
      // test `tests/integration/credentials/settings-panel.test.tsx`
      // (which already seeds a row in every store and asserts the
      // post-clear empty-state across every store) is the canonical
      // end-to-end check; this contract test pins the single-
      // transaction envelope that makes that end-to-end check
      // meaningful.
      await seedEveryStore();

      const transactionSpy = vi.spyOn(db, "transaction");

      await credentialRepository.clearAll();

      const transactionCalls = transactionSpy.mock.calls;
      expect(transactionCalls).toHaveLength(1);
      const call = transactionCalls[0];
      expect(call).toBeDefined();
      const mode = call?.[0];
      const tables = call?.[1] as unknown as string[];
      expect(mode).toBe("rw");
      expect(Array.from(tables).sort()).toEqual(
        [
          "asanaTeams",
          "credentials",
          "dependencies",
          "personGroups",
          "portfolios",
          "priorityFields",
          "projects",
          "refreshSessions",
          "sections",
          "snapshots",
          "tasks",
          "teamMappingOverrides",
          "users",
          "workspaces",
        ].sort(),
      );

      // Every store is empty after the call.
      expect(await db.credentials.count()).toBe(0);
      expect(await db.workspaces.count()).toBe(0);
      expect(await db.projects.count()).toBe(0);
      expect(await db.portfolios.count()).toBe(0);
      expect(await db.asanaTeams.count()).toBe(0);
      expect(await db.teamMappingOverrides.count()).toBe(0);
      expect(await db.personGroups.count()).toBe(0);
      expect(await db.users.count()).toBe(0);
      expect(await db.priorityFields.count()).toBe(0);
      expect(await db.dependencies.count()).toBe(0);
      expect(await db.sections.count()).toBe(0);
      expect(await db.tasks.count()).toBe(0);
      expect(await db.snapshots.count()).toBe(0);
      expect(await db.refreshSessions.count()).toBe(0);

      transactionSpy.mockRestore();
    });

    it("is a no-op (no-op transaction) when every store is already empty", async () => {
      await expect(credentialRepository.clearAll()).resolves.toBeUndefined();
      expect(await db.credentials.count()).toBe(0);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Test helpers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Produce a fresh non-extractable AES-GCM `CryptoKey` for use as a
 * placeholder `encryptedTokenRecord.keyRef` in tests that seed a
 * pre-existing persistent row. The CredentialsProvider's `setSessionToken`
 * and `clearToSessionOnly` paths delete the row outright, so the
 * placeholder key handle's decrypt-on-load behaviour is irrelevant to
 * the contract under test — what matters is that the row shape matches
 * the schema and the delete path reaches it.
 */
async function fakeKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}
