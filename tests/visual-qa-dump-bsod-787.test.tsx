/** Capture the real reporting controls for BSOD-787 visual review. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { useState, type ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { resolveDateRangePreset } from "../src/domain/datetime";
import type {
  DateRangePreset,
  FilterCriteria,
  ISODate,
} from "../src/domain/types";
import { ReportingPeriodControl } from "../src/features/dashboard/ReportingPeriodControl";
import { FilterPillBar } from "../src/features/filters/FilterPillBar";
import { describeValue } from "../src/features/filters/filter-model";

const NOW = new Date("2026-03-15T12:00:00.000Z");
const OLDEST_ACTIVITY = "2025-01-10" as ISODate;
const OUTPUT_DIR = resolve(process.cwd(), ".multica/visual-qa");

/** The dashboard's header and filter strip, with fixed cache data. */
function ReportingControls(): ReactElement {
  const [criteria, setCriteria] = useState<FilterCriteria>(() => ({
    dateRange: {
      ...resolveDateRangePreset("last_90_days", NOW, "utc"),
      preset: "last_90_days",
    },
  }));

  const selectPeriod = (preset: DateRangePreset): void => {
    const bounds = resolveDateRangePreset(preset, NOW, "utc");
    setCriteria((current) => ({
      ...current,
      dateRange: {
        ...bounds,
        // The dashboard closes all_time against the cache's oldest
        // activity before passing the range to FilterPillBar.
        start: preset === "all_time" ? OLDEST_ACTIVITY : bounds.start,
        preset,
      },
    }));
  };

  const period = criteria.dateRange?.preset ?? "last_90_days";
  const periodLabel = describeValue(criteria, "dateRange", {
    users: [],
    projects: [],
    timezone: "utc",
  });

  return (
    <main className="team-dash-shell" lang="en-AU">
      <header className="td-dashboard__masthead">
        <div className="td-dashboard__identity">
          <h1>Team Dash</h1>
          <p className="td-dashboard__scope" data-testid="dashboard-scope">
            Team Dash Workspace · 1 project · {periodLabel}
          </p>
        </div>
        <ReportingPeriodControl value={period} onChange={selectPeriod} />
        <nav className="td-dashboard__actions" aria-label="Dashboard">
          <a href="/settings" data-testid="nav-settings">
            Settings
          </a>
        </nav>
      </header>
      <FilterPillBar
        criteria={criteria}
        onChange={setCriteria}
        users={[]}
        projects={[]}
        now={NOW}
        timezone="utc"
      />
    </main>
  );
}

async function capture(label: string, container: HTMLElement): Promise<void> {
  // HTML serialization drops live form properties after interaction.
  // Transfer them to attributes so Chromium renders the same selection.
  const snapshot = container.cloneNode(true) as HTMLElement;
  const liveSelects = container.querySelectorAll("select");
  const savedSelects = snapshot.querySelectorAll("select");
  liveSelects.forEach((live, index) => {
    const saved = savedSelects[index];
    Array.from(saved.options).forEach((option, optionIndex) => {
      if (live.options[optionIndex].selected) {
        option.setAttribute("selected", "");
      } else {
        option.removeAttribute("selected");
      }
    });
  });
  const liveInputs = container.querySelectorAll("input");
  const savedInputs = snapshot.querySelectorAll("input");
  liveInputs.forEach((live, index) => {
    const saved = savedInputs[index];
    if (live.checked) {
      saved.setAttribute("checked", "");
    } else {
      saved.removeAttribute("checked");
    }
    saved.setAttribute("value", live.value);
  });
  await writeFile(
    resolve(OUTPUT_DIR, `bsod-787-${label}.html`),
    snapshot.innerHTML,
    "utf8",
  );
}

describe("BSOD-787 visual QA capture", () => {
  it("captures the default, all-time, and custom-editor states", async () => {
    await mkdir(OUTPUT_DIR, { recursive: true });
    const { container } = render(<ReportingControls />);

    expect(screen.getByTestId("reporting-period")).toHaveValue("last_90_days");
    expect(screen.getByTestId("dashboard-scope")).toHaveTextContent(
      "Last 90 days",
    );
    await capture("default", container);

    fireEvent.change(screen.getByTestId("reporting-period"), {
      target: { value: "all_time" },
    });
    expect(screen.getByTestId("dashboard-scope")).toHaveTextContent("All time");
    expect(
      screen.getByRole("button", { name: /Date range:/ }),
    ).toHaveTextContent("All time");
    expect(container.textContent).not.toContain("1 Jan 1000");
    await capture("all-time", container);

    fireEvent.click(screen.getByRole("button", { name: /Date range:/ }));
    fireEvent.click(screen.getByLabelText("Custom range"));
    expect(screen.getByLabelText("From")).toHaveValue(OLDEST_ACTIVITY);
    await capture("custom-editor", container);
  });
});
