/**
 * What is open on screen for a doc — which question cards are expanded, and which sections are
 * collapsed — remembered per doc.
 *
 * This is view state, not document state: it says what one reader has open on one machine, so it
 * lives in localStorage rather than in the doc's room. Syncing it would let a collaborator's
 * collapse close a card someone else was reading.
 *
 * Both sets record *deviations from the default*, which is why one holds expanded questions and the
 * other holds collapsed sections: cards start closed and sections start open, so in each case an
 * absent key means "as it comes".
 *
 * Stored as a most-recently-touched-first list so old docs can be dropped once the list grows past
 * `MAX_DOCS`, rather than accumulating an entry per doc ever opened.
 */

const STORAGE_KEY = "questionExpansion";
const MAX_DOCS = 25;

/** A set of ids. Present means the deviation applies; absent means the default. */
export type IdSet = Record<string, true>;

export interface DocViewState {
  /** Question ids whose card is expanded. */
  expandedQuestions: IdSet;
  /** SectionInfo keys whose question list is hidden. */
  collapsedSections: IdSet;
}

export const EMPTY_VIEW_STATE: DocViewState = {
  expandedQuestions: {},
  collapsedSections: {},
};

interface Entry {
  docId: string;
  ids: string[];
  /** Optional: entries written before sections were collapsible do not carry it. */
  collapsedSections?: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function readEntries(): Entry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Anything malformed is dropped rather than trusted: this is a cache of a preference, so a
    // corrupt entry is not worth surfacing — it just reverts that doc to its default view.
    return parsed.filter(
      (entry): entry is Entry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Entry).docId === "string" &&
        isStringArray((entry as Entry).ids) &&
        ((entry as Entry).collapsedSections === undefined ||
          isStringArray((entry as Entry).collapsedSections))
    );
  } catch {
    return [];
  }
}

function toIdSet(ids: string[] | undefined): IdSet {
  const set: IdSet = {};
  for (const id of ids ?? []) set[id] = true;
  return set;
}

/** How this doc was left last time it was on screen. Defaults when it has never been seen. */
export function loadViewState(docId: string): DocViewState {
  const entry = readEntries().find((e) => e.docId === docId);
  if (!entry) return EMPTY_VIEW_STATE;
  return {
    expandedQuestions: toIdSet(entry.ids),
    collapsedSections: toIdSet(entry.collapsedSections),
  };
}

/**
 * Record how this doc is left, moving it to the front of the list.
 *
 * A doc sitting at its defaults is removed instead of stored: no entry and an empty entry mean the
 * same thing, and dropping it keeps the cap spent on docs that actually have state.
 */
export function saveViewState(docId: string, state: DocViewState): void {
  const ids = Object.keys(state.expandedQuestions);
  const collapsedSections = Object.keys(state.collapsedSections);
  const others = readEntries().filter((e) => e.docId !== docId);
  const next =
    ids.length > 0 || collapsedSections.length > 0
      ? [{ docId, ids, collapsedSections }, ...others]
      : others;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(0, MAX_DOCS)));
  } catch {
    // Storage full or blocked. The expansion still works for this visit; it just will not survive
    // a reload, which is not worth interrupting anyone over.
  }
}
