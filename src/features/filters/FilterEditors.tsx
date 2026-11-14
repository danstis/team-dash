/**
 * The value editors the filter pill bar opens: one panel per kind of
 * filter, shown when the reader adds a filter or clicks a pill.
 *
 * Single-choice kinds (completion, estimate, overdue, priority, and the
 * date presets) commit the moment a choice is made. Multi-value kinds
 * (person, project) and the custom date range stage a draft and commit
 * on Apply, so Escape and Cancel leave the report as it was (DESIGN.md ›
 * The Escape Cancels Rule).
 */
import { useId, useMemo, useState, type ReactElement } from "react";

import { resolveDateRangePreset, toIsoDate } from "../../domain/datetime";
import {
  DATE_RANGE_PRESETS,
  type FilterCriteria,
  type ISODate,
  type TimezoneSetting,
} from "../../domain/types";
import {
  FILTER_LABELS,
  PRESET_LABELS,
  SINGLE_CHOICES,
  currentChoice,
  withChoice,
  type FilterKind,
  type FilterValueOption,
} from "./filter-model";

/** What every editor is given. */
export interface FilterEditorProps {
  readonly kind: FilterKind;
  readonly criteria: FilterCriteria;
  readonly users: readonly FilterValueOption[];
  readonly projects: readonly FilterValueOption[];
  readonly now: Date;
  readonly timezone: TimezoneSetting;
  /** Called with the complete next criteria when the reader commits. */
  readonly onCommit: (criteria: FilterCriteria) => void;
  /** Called when the reader backs out; nothing has changed. */
  readonly onCancel: () => void;
}

/** A radio list whose choice commits as soon as it is made. */
function ChoiceList({
  legend,
  choices,
  value,
  onPick,
}: Readonly<{
  legend: string;
  choices: readonly { value: string; label: string }[];
  value: string;
  onPick: (value: string) => void;
}>): ReactElement {
  const name = useId();
  return (
    <fieldset className="td-filter-editor__choices">
      <legend>{legend}</legend>
      {choices.map((choice) => (
        <label key={choice.value} className="td-filter-editor__option">
          <input
            type="radio"
            name={name}
            value={choice.value}
            checked={value === choice.value}
            onChange={() => {
              onPick(choice.value);
            }}
          />
          <span>{choice.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

function DateRangeEditor({
  criteria,
  now,
  timezone,
  onCommit,
  onCancel,
}: Readonly<FilterEditorProps>): ReactElement {
  const range = criteria.dateRange;
  const anchor = toIsoDate(now, timezone);
  const [custom, setCustom] = useState(range?.preset === "custom");
  const [start, setStart] = useState<string>(range?.start ?? anchor);
  const [end, setEnd] = useState<string>(range?.end ?? anchor);
  const invalid = start === "" || end === "" || start > end;

  const choices = [
    ...DATE_RANGE_PRESETS.map((preset) => ({
      value: preset,
      label: PRESET_LABELS[preset],
    })),
    { value: "custom", label: "Custom range" },
  ];
  const selected = custom ? "custom" : (range?.preset ?? "");

  return (
    <>
      <ChoiceList
        legend="Reporting window"
        choices={choices}
        value={selected}
        onPick={(value) => {
          if (value === "custom") {
            setCustom(true);
            return;
          }
          const preset = DATE_RANGE_PRESETS.find((p) => p === value);
          if (preset === undefined) {
            return;
          }
          const bounds = resolveDateRangePreset(preset, now, timezone);
          onCommit({
            ...criteria,
            dateRange: { start: bounds.start, end: bounds.end, preset },
          });
        }}
      />
      {custom ? (
        <div className="td-filter-editor__dates">
          <label>
            From{" "}
            <input
              type="date"
              value={start}
              onChange={(event) => {
                setStart(event.target.value);
              }}
            />
          </label>
          <label>
            To{" "}
            <input
              type="date"
              value={end}
              onChange={(event) => {
                setEnd(event.target.value);
              }}
            />
          </label>
          {invalid ? (
            // A native output announces this status without an added ARIA role.
            <output className="td-filter-editor__hint">
              Choose a start date that is on or before the end date.
            </output>
          ) : null}
          <div className="td-filter-editor__actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              data-variant="primary"
              disabled={invalid}
              onClick={() => {
                onCommit({
                  ...criteria,
                  dateRange: {
                    start: start as ISODate,
                    end: end as ISODate,
                    preset: "custom",
                  },
                });
              }}
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** A searchable checkbox list: person (with Unassigned) or project. */
function MultiEditor({
  kind,
  criteria,
  users,
  projects,
  onCommit,
  onCancel,
}: Readonly<FilterEditorProps>): ReactElement {
  const isPerson = kind === "person";
  const options = isPerson ? users : projects;
  let initial: readonly string[] = criteria.projectGids ?? [];
  if (isPerson) {
    initial = Array.isArray(criteria.assigneeGids) ? criteria.assigneeGids : [];
  }
  const [selected, setSelected] = useState<readonly string[]>(initial);
  const [unassigned, setUnassigned] = useState(
    isPerson && criteria.assigneeGids === "unassigned",
  );
  const [query, setQuery] = useState("");
  const searchId = useId();

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle === ""
      ? options
      : options.filter((option) => option.name.toLowerCase().includes(needle));
  }, [options, query]);

  const nothingChosen = selected.length === 0 && !unassigned;
  const noun = isPerson ? "people" : "projects";

  const toggle = (gid: string, checked: boolean): void => {
    if (checked) {
      // The domain models "unassigned" and named people as alternatives.
      setUnassigned(false);
      setSelected([...selected, gid]);
      return;
    }
    setSelected(selected.filter((existing) => existing !== gid));
  };

  const commit = (): void => {
    if (isPerson) {
      onCommit({
        ...criteria,
        assigneeGids: unassigned ? "unassigned" : [...selected],
      });
      return;
    }
    onCommit({ ...criteria, projectGids: [...selected] });
  };

  return (
    <>
      <label htmlFor={searchId} className="td-filter-editor__search-label">
        Search {noun}
      </label>
      <input
        id={searchId}
        type="search"
        className="td-filter-editor__search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      <fieldset className="td-filter-editor__choices td-filter-editor__scroll">
        <legend>{FILTER_LABELS[kind]}</legend>
        {isPerson ? (
          <label className="td-filter-editor__option">
            <input
              type="checkbox"
              checked={unassigned}
              onChange={(event) => {
                setUnassigned(event.target.checked);
                if (event.target.checked) {
                  setSelected([]);
                }
              }}
            />
            <span>Unassigned</span>
          </label>
        ) : null}
        {visible.map((option) => (
          <label key={option.gid} className="td-filter-editor__option">
            <input
              type="checkbox"
              checked={selected.includes(option.gid)}
              onChange={(event) => {
                toggle(option.gid, event.target.checked);
              }}
            />
            <span>{option.name}</span>
          </label>
        ))}
        {visible.length === 0 ? (
          // A native output announces this status without an added ARIA role.
          <output className="td-filter-editor__hint">
            {query.trim() === ""
              ? `No ${noun} in the cached data yet. Refresh to load them.`
              : `No ${noun} match “${query}”.`}
          </output>
        ) : null}
      </fieldset>
      <div className="td-filter-editor__actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          data-variant="primary"
          disabled={nothingChosen}
          onClick={commit}
        >
          Apply
        </button>
      </div>
      {nothingChosen ? (
        <p className="td-filter-editor__hint">
          Choose at least one to apply this filter.
        </p>
      ) : null}
    </>
  );
}

/** The editor panel body for one kind of filter. */
export function FilterEditor(props: Readonly<FilterEditorProps>): ReactElement {
  const { kind, criteria, onCommit } = props;
  if (kind === "dateRange") {
    return <DateRangeEditor {...props} />;
  }
  if (kind === "person" || kind === "project") {
    return <MultiEditor {...props} />;
  }
  const choices = SINGLE_CHOICES[kind] ?? [];
  return (
    <ChoiceList
      legend={FILTER_LABELS[kind]}
      choices={choices}
      value={currentChoice(criteria, kind)}
      onPick={(value) => {
        onCommit(withChoice(criteria, kind, value));
      }}
    />
  );
}
