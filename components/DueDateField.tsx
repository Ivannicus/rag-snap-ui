"use client";

import { useEffect, useState } from "react";

interface Props {
  /** ISO date string, or null when unset. */
  value: string | null;
  overdue: boolean;
  onChange: (isoDate: string | null) => void;
}

/** `2026-08-31` — what `<input type="date">` reads and writes. */
function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

/**
 * `30 Sep 2026`.
 *
 * Deliberately without the word "Due" and without a weekday: the field's row already carries a "Due"
 * label, and the control is a fixed width that a longer string would simply be clipped by.
 */
function formatDueDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Inline-editable due date.
 *
 * Reads as text until clicked, then becomes a native date input — a date picker without shipping one.
 * Committing writes an ISO string at UTC midnight of the chosen day, so a due date means the same
 * calendar day to everyone looking at the dashboard rather than shifting by the reader's offset.
 *
 * `draft` is seeded from the prop and re-seeded when it changes, so a due date another lead sets while
 * this card is on screen shows up here rather than being masked by stale local state.
 */
export default function DueDateField({ value, overdue, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => toDateInputValue(value));

  useEffect(() => {
    setDraft(toDateInputValue(value));
  }, [value]);

  function commit(next: string) {
    setEditing(false);
    if (!next) {
      if (value !== null) onChange(null);
      return;
    }
    const iso = new Date(`${next}T00:00:00.000Z`).toISOString();
    if (iso !== value) onChange(iso);
  }

  if (editing) {
    return (
      <input
        type="date"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(draft);
          if (e.key === "Escape") {
            setDraft(toDateInputValue(value));
            setEditing(false);
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className="u-no-margin--bottom due-date-field__input"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      // `--empty` centres the placeholder, matching the Team control's empty state. A set date stays
      // left-aligned against its icon, so it does not appear to shift each time the date changes.
      className={`due-date-field p-button--base is-dense u-no-margin--bottom${
        value ? "" : " due-date-field--empty"
      }${overdue ? " due-date-field--overdue" : ""}`}
      title={value ? "Change due date" : "Set a due date"}
      aria-label={
        value
          ? `Due ${formatDueDate(value)}${overdue ? ", overdue" : ""}. Change due date.`
          : "Set a due date"
      }
    >
      {/* Vanilla has no calendar icon; `snooze` is its clock face and the closest thing to a date. */}
      <i className={overdue ? "p-icon--error" : "p-icon--snooze"} aria-hidden></i>
      {/* No inline "Overdue" flag. It would not fit the fixed width, and the card already says so twice
          over — in red on this control and as a status badge in its header. */}
      <span className="due-date-field__value">
        {value ? formatDueDate(value) : "Set date"}
      </span>
    </button>
  );
}
