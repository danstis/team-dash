import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchEventsSince } from "../../../../src/data/asana/client";

describe("Asana client unit guards", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns `validation_error` without network I/O when fetchEventsSince is missing a resource gid", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("fetch should not run"));

    const result = await fetchEventsSince("token", undefined, "sync-token");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.outcome).toBe("validation_error");
    if (result.outcome !== "validation_error") return;
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["resource"],
        }),
      ]),
    );
  });
});
