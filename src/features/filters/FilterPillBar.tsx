/**
 * The reporting filter bar: one strip above the charts that holds every
 * filter as a pill.
 *
 * The reader opens "Add filter", picks a kind, chooses its values, and the
 * filter becomes a pill beside the others. A pill is clickable to change
 * its values and carries an X to remove it. Each kind can appear once, so
 * the menu lists only the kinds that are not already in use. The date
 * range is the report's window, so its pill can be edited but not removed.
 *
 * The bar is CONTROLLED: it renders the criteria it is given and reports
 * each change as a complete new `FilterCriteria`; it keeps no filter state
 * of its own (DESIGN.md › The State Is One Source Rule).
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import type { FilterCriteria, TimezoneSetting } from "../../domain/types";
import { FilterEditor } from "./FilterEditors";
import {
  FILTER_LABELS,
  activeKinds,
  availableKinds,
  clearKind,
  clearRemovable,
  describeValue,
  hasRemovableFilters,
  isRemovable,
  type FilterKind,
  type FilterValueOption,
} from "./filter-model";

export interface FilterPillBarProps {
  readonly criteria: FilterCriteria;
  readonly onChange: (criteria: FilterCriteria) => void;
  readonly users: readonly FilterValueOption[];
  readonly projects: readonly FilterValueOption[];
  /** The instant presets resolve against; injected, never read from the clock. */
  readonly now: Date;
  readonly timezone?: TimezoneSetting;
  /** Chart controls shown at the end of the bar, apart from the pills. */
  readonly trailing?: ReactNode;
}

function CloseIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4 4l8 8M12 4l-8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlusIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M8 3v10M3 8h10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** What is open: the add menu, or an editor for a kind (new or existing). */
type Open =
  | { readonly type: "menu" }
  | { readonly type: "editor"; readonly kind: FilterKind };

export function FilterPillBar({
  criteria,
  onChange,
  users,
  projects,
  now,
  timezone = "local",
  trailing,
}: Readonly<FilterPillBarProps>): ReactElement {
  const [open, setOpen] = useState<Open | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const pillRefs = useRef(new Map<FilterKind, HTMLButtonElement>());
  const panelId = useId();
  const menuId = useId();

  const kinds = activeKinds(criteria);
  const available = availableKinds(criteria);
  const describeContext = { users, projects, timezone };

  /** Return focus to whatever opened the panel, once it has closed. */
  const close = useCallback((returnTo: FilterKind | "add" | null): void => {
    setOpen(null);
    queueMicrotask(() => {
      if (returnTo === "add") {
        addRef.current?.focus();
      } else if (returnTo !== null) {
        (pillRefs.current.get(returnTo) ?? addRef.current)?.focus();
      }
    });
  }, []);

  // Escape closes without committing; a press outside the bar does too.
  useEffect(() => {
    if (open === null) {
      return undefined;
    }
    const returnTo =
      open.type === "editor" && activeKinds(criteria).includes(open.kind)
        ? open.kind
        : "add";
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        close(returnTo);
      }
    };
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (open.type === "editor" && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(returnTo);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, criteria, close]);

  const commit = (next: FilterCriteria, kind: FilterKind): void => {
    onChange(next);
    setAnnouncement(`${FILTER_LABELS[kind]} filter set.`);
    close(kind);
  };

  const remove = (kind: FilterKind): void => {
    onChange(clearKind(criteria, kind));
    setAnnouncement(`${FILTER_LABELS[kind]} filter removed.`);
    close("add");
  };

  const editor = (
    kind: FilterKind,
    returnTo: FilterKind | "add",
  ): ReactElement => (
    <dialog
      open
      className="td-filterbar__panel"
      aria-label={`${FILTER_LABELS[kind]} filter`}
      id={panelId}
    >
      <FilterEditor
        kind={kind}
        criteria={criteria}
        users={users}
        projects={projects}
        now={now}
        timezone={timezone}
        onCommit={(next) => {
          commit(next, kind);
        }}
        onCancel={() => {
          close(returnTo);
        }}
      />
    </dialog>
  );

  // Focus the first control of a panel or menu when it opens.
  useEffect(() => {
    if (open === null) {
      return;
    }
    const target = rootRef.current?.querySelector<HTMLElement>(
      ".td-filterbar__panel input, .td-filterbar__panel button, .td-filterbar__menu button",
    );
    target?.focus();
  }, [open]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
    );
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      close("add");
    }
  };

  const addControls =
    open === null ? undefined : { menu: menuId, editor: panelId }[open.type];

  return (
    <section
      className="td-filterbar"
      data-testid="filter-pill-bar"
      aria-label="Report filters"
    >
      <div className="td-filterbar__strip" ref={rootRef}>
        <ul className="td-filterbar__pills">
          {kinds.map((kind) => (
            <li key={kind} className="td-filterbar__slot">
              <span
                className="td-pill"
                data-testid="filter-pill"
                data-kind={kind}
              >
                <button
                  type="button"
                  className="td-pill__edit"
                  aria-haspopup="dialog"
                  aria-expanded={open?.type === "editor" && open.kind === kind}
                  aria-controls={
                    open?.type === "editor" && open.kind === kind
                      ? panelId
                      : undefined
                  }
                  ref={(node) => {
                    if (node === null) {
                      pillRefs.current.delete(kind);
                    } else {
                      pillRefs.current.set(kind, node);
                    }
                  }}
                  onClick={() => {
                    setOpen(
                      open?.type === "editor" && open.kind === kind
                        ? null
                        : { type: "editor", kind },
                    );
                  }}
                >
                  <span className="td-pill__label">{FILTER_LABELS[kind]}:</span>{" "}
                  <span className="td-pill__value">
                    {describeValue(criteria, kind, describeContext)}
                  </span>
                </button>
                {isRemovable(kind) ? (
                  <button
                    type="button"
                    className="td-pill__remove"
                    aria-label={`Remove ${FILTER_LABELS[kind]} filter`}
                    onClick={() => {
                      remove(kind);
                    }}
                  >
                    <CloseIcon />
                  </button>
                ) : null}
              </span>
              {open?.type === "editor" && open.kind === kind
                ? editor(kind, kind)
                : null}
            </li>
          ))}
          <li className="td-filterbar__slot">
            {available.length > 0 ? (
              <button
                type="button"
                className="td-filterbar__add"
                aria-haspopup="menu"
                aria-expanded={open !== null && open.type === "menu"}
                aria-controls={addControls}
                ref={addRef}
                onClick={() => {
                  setOpen(open?.type === "menu" ? null : { type: "menu" });
                }}
              >
                <PlusIcon /> Add filter
              </button>
            ) : (
              <span className="td-filterbar__all-added">
                All filters in use
              </span>
            )}
            {open?.type === "menu" ? (
              <ul
                className="td-filterbar__menu"
                id={menuId}
                role="menu"
                aria-label="Add a filter"
                onKeyDown={onMenuKeyDown}
              >
                {available.map((kind) => (
                  <li key={kind} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpen({ type: "editor", kind });
                      }}
                    >
                      {FILTER_LABELS[kind]}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {open?.type === "editor" && !kinds.includes(open.kind)
              ? editor(open.kind, "add")
              : null}
          </li>
          {hasRemovableFilters(criteria) ? (
            <li className="td-filterbar__slot">
              <button
                type="button"
                className="td-filterbar__clear"
                onClick={() => {
                  onChange(clearRemovable(criteria));
                  setAnnouncement("All filters cleared. The date range stays.");
                  close("add");
                }}
              >
                Clear filters
              </button>
            </li>
          ) : null}
        </ul>
      </div>
      {trailing !== undefined ? (
        <div className="td-filterbar__trailing">{trailing}</div>
      ) : null}
      {/* The native output has an implicit status role for filter outcomes. */}
      <output className="td-visually-hidden">{announcement}</output>
    </section>
  );
}
