/**
 * T019 — `dedupeByGid` unit tests (Red phase for T017).
 *
 * Verifies the dedup contract every metric calculator relies on per
 * FR-036 (`/specs/001-asana-team-dashboard/spec.md`), FR-038/FR-039/FR-040
 * (dedup rule applied consistently to all aggregates), and
 * `contracts/metrics-engine.md` Shared Output Rule 1 ("any total at or
 * above single-project grouping MUST deduplicate by `gid` using
 * `domain/dedup`'s `dedupeByGid` helper — never a hand-rolled `Set` per
 * metric").
 *
 * The tests MUST fail before `src/domain/dedup/dedupeByGid.ts` is
 * implemented and pass after it, per Constitution Principle III. Each test
 * is deliberately self-explanatory — a reviewer should not have to read
 * the implementation to know why each behaviour is being verified.
 *
 * The helper sits in `src/domain/**` so it MUST stay presentation-free,
 * browser-free, and network-free per the ESLint boundary rule in
 * `eslint.config.js`; these tests live under `tests/unit/domain/dedup`
 * and exercise the helper directly via TypeScript types, with no React,
 * IndexedDB, or fetch involvement.
 */
import { describe, expect, it } from "vitest";
import { dedupeByGid } from "../../../../src/domain/dedup/dedupeByGid";

/**
 * Local fixture shape mirroring the Asana `Task` fields a dedup helper
 * needs to reason about (`gid` is the contract surface; everything else is
 * incidental so we can assert the generic preserves arbitrary payload
 * shape unchanged).
 */
interface FixtureItem {
  gid: string;
  name: string;
  projectGids?: string[];
}

const fixture = (
  gid: string,
  name: string,
  projectGids: string[] = [],
): FixtureItem => ({ gid, name, projectGids });

describe("T019 dedupeByGid (FR-036 helper)", () => {
  describe("empty / trivial inputs", () => {
    it("returns an empty array when given an empty input", () => {
      expect(dedupeByGid([])).toEqual([]);
    });

    it("returns a single-element array unchanged when there is no duplicate", () => {
      const input: FixtureItem[] = [fixture("gid-1", "only")];
      expect(dedupeByGid(input)).toEqual(input);
    });
  });

  describe("FR-036 first-occurrence preservation", () => {
    it("returns both items, in original order, when all gids are unique", () => {
      const a = fixture("gid-a", "Alpha");
      const b = fixture("gid-b", "Bravo");
      const c = fixture("gid-c", "Charlie");

      const result = dedupeByGid<FixtureItem>([a, b, c]);

      expect(result).toEqual([a, b, c]);
      expect(result.map((item) => item.gid)).toEqual([
        "gid-a",
        "gid-b",
        "gid-c",
      ]);
    });

    it("preserves the FIRST occurrence when the same gid appears twice", () => {
      const first = fixture("gid-a", "Alpha — first");
      const second = fixture("gid-a", "Alpha — second");

      const result = dedupeByGid<FixtureItem>([first, second]);

      expect(result).toHaveLength(1);
      // FR-036 dedup is *content-preserving*: the first occurrence wins so a
      // calculation is reproducible from the original input ordering. The
      // exact object reference surviving the dedup is not part of the
      // contract, but the `name` payload of the first entry MUST.
      expect(result[0]?.name).toBe("Alpha — first");
      expect(result[0]?.gid).toBe("gid-a");
    });

    it("preserves the FIRST occurrence across three duplicates", () => {
      const first = fixture("gid-x", "first");
      const second = fixture("gid-x", "second");
      const third = fixture("gid-x", "third");

      const result = dedupeByGid<FixtureItem>([first, second, third]);

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("first");
    });

    it("does not collapse distinct items whose names coincide", () => {
      // FR-017 treats gids as opaque strings, but the dedup contract keys
      // SOLELY on `gid`; a coincidental name collision must NOT be enough
      // to drop a row.
      const a = fixture("gid-a", "Same Name");
      const b = fixture("gid-b", "Same Name");

      const result = dedupeByGid<FixtureItem>([a, b]);

      expect(result).toHaveLength(2);
    });
  });

  describe("realistic Asana-style multi-project scenario (FR-036)", () => {
    it("returns each task once even when a task belongs to two projects (multi-membership)", () => {
      // The Asana cache stores a task's full project-membership list on
      // the same `gid` row, so `gid-7` showing up under both projects is
      // the same physical task, not two rows. Workspace and reporting-
      // team totals apply dedup on `gid` to honour FR-036.
      const task1FromA = fixture("gid-1", "Write spec", ["proj-a"]);
      const task1FromB = fixture("gid-1", "Write spec", ["proj-b"]);
      const task2 = fixture("gid-2", "Review PR", ["proj-a"]);

      const result = dedupeByGid<FixtureItem>([task1FromA, task1FromB, task2]);

      expect(result).toHaveLength(2);
      expect(result.map((item) => item.gid)).toEqual(["gid-1", "gid-2"]);
      // First-occurrence payload preserved: the task keeps its project-a
      // membership entry rather than the duplicate occurrence from
      // project-b. (The exact reference is not part of the contract;
      // `projectGids` equal-deep equality is the assertion.)
      expect(result[0]?.projectGids).toEqual(["proj-a"]);
    });

    it("handles a long task-list with interleaved duplicates deterministically", () => {
      // A representative dedup pass over a 25k-style dataset (here scaled
      // down for test runtime; the contract is the same).
      const gids = [
        "gid-1",
        "gid-2",
        "gid-1",
        "gid-3",
        "gid-2",
        "gid-4",
        "gid-1",
        "gid-5",
      ];
      const items = gids.map((gid, index) => fixture(gid, `item-${index}`));

      const result = dedupeByGid(items);

      expect(result.map((item) => item.gid)).toEqual([
        "gid-1",
        "gid-2",
        "gid-3",
        "gid-4",
        "gid-5",
      ]);
      // First-occurrence index survives for every distinct gid.
      const nameByGid = Object.fromEntries(
        result.map((item) => [item.gid, item.name]),
      );
      expect(nameByGid["gid-1"]).toBe("item-0");
      expect(nameByGid["gid-2"]).toBe("item-1");
      expect(nameByGid["gid-3"]).toBe("item-3");
      expect(nameByGid["gid-4"]).toBe("item-5");
      expect(nameByGid["gid-5"]).toBe("item-7");
    });
  });

  describe("FR-017 `gid` is an opaque string (no numeric assumptions)", () => {
    it("treats gids that differ only in numeric-looking prefix as distinct", () => {
      const a = fixture("12", "twelve");
      const b = fixture("012", "zero-twelve");

      const result = dedupeByGid<FixtureItem>([a, b]);

      expect(result).toHaveLength(2);
    });

    it("treats gids with case differences as distinct", () => {
      const a = fixture("AbC", "uppercase-ish");
      const b = fixture("abc", "lowercase");

      const result = dedupeByGid<FixtureItem>([a, b]);

      expect(result).toHaveLength(2);
    });
  });

  describe("immutability (Constitution Principle VI: pure helpers)", () => {
    it("does not mutate the input array", () => {
      const a = fixture("gid-a", "A");
      const b = fixture("gid-b", "B");
      const input: FixtureItem[] = [a, a, b];
      const snapshot = [...input];

      dedupeByGid(input);

      // Input order and contents are byte-identical to the pre-call state.
      expect(input).toEqual(snapshot);
    });
  });

  describe("generic shape contract", () => {
    it("accepts shapes that carry additional fields beyond `gid`", () => {
      // The helper is generic, so a feature module can pass rows whose
      // payload shape extends `{ gid: string }` without losing any
      // non-`gid` data.
      type Extended = FixtureItem & {
        assigneeGid: string | null;
        estimatedMinutes: number | null;
      };

      const a: Extended = {
        gid: "gid-a",
        name: "Alpha",
        assigneeGid: "user-1",
        estimatedMinutes: 90,
      };
      const b: Extended = {
        gid: "gid-a",
        name: "Alpha-duplicate",
        assigneeGid: "user-2",
        estimatedMinutes: 45,
      };

      const result = dedupeByGid<Extended>([a, b]);

      expect(result).toHaveLength(1);
      expect(result[0]?.assigneeGid).toBe("user-1");
      expect(result[0]?.estimatedMinutes).toBe(90);
    });
  });
});
