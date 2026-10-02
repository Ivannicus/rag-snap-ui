/**
 * The one codec between a due date as stored and a due date as an `<input type="date">` reads it.
 *
 * A due date is stored as a full ISO string at **UTC midnight** of the chosen day, so it means the
 * same calendar day to everyone looking at it rather than shifting by the reader's offset. Both
 * directions of that conversion live here because two controls now need them — the dashboard card's
 * inline `DueDateField` and the new-project modal's form field — and a second copy would be a second
 * chance to drop the `Z` and reintroduce the off-by-one-day bug documented in `DueDateField`.
 */

/** `2026-08-31` — what `<input type="date">` reads and writes. `""` for an unset date. */
export function isoToDateInput(iso: string | null): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  // The UTC date part taken directly, not via any local-time accessor: the value was written at UTC
  // midnight, so reading it in the reader's zone would hand back the previous day west of UTC.
  return parsed.toISOString().slice(0, 10);
}

/**
 * An `<input type="date">` value back to a stored due date: UTC midnight of that day, or `null` for
 * an empty input, which is how "no due date" is represented throughout.
 */
export function dateInputToIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}
