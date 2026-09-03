export interface QAItem {
  id: string;
  question: string;
  answer: string;
}

export interface QAFile {
  generated_at: string;
  model: string;
  /** Some files use "results", spec says "result" — we handle both */
  results?: QAItem[];
  result?: QAItem[];
}

export interface ParsedQAFile {
  generated_at: string;
  model: string;
  items: QAItem[];
}

export type FilterStatus = "all" | "answered" | "unanswered";

export interface Filters {
  status: FilterStatus;
  // "" = all sections; a plain section number (e.g. "1") = that section;
  // "assignee:<TeamMember.id>" / "reviewer:<TeamMember.id>" = sections containing
  // at least one item where that member is the assignee/reviewer
  section: string;
  search: string;
}

export interface PersonFilterOption {
  value: string;
  label: string;
}

/**
 * The only per-item state that is ever stored.
 *
 * The workflow has three states, but two of them are derived: an item the AI left blank is
 * `unanswered`, an answered item that nobody has signed off is `ready`, and only the sign-off itself
 * needs recording. Storing "ready" as well would mean writing a value for every item in every
 * project at upload time, and would then have to be kept in step with edits that fill a blank.
 */
export type ItemStatus = "approved";

export interface SessionState {
  data: ParsedQAFile;
  filename: string;
  editedAnswers: Record<string, string>;
  ratings: Record<string, number>;
  /**
   * item.id -> URL. **Read-only**: the input that set these was removed from the question card, so
   * nothing writes this map any more. It is still seeded, decoded and exported, so URLs attached
   * before the removal keep their badge and their CSV column instead of silently disappearing.
   */
  contextUrls: Record<string, string>;
  /** item.id -> "approved". Absent means ready (if answered) or unanswered (if blank). */
  itemStatus: Record<string, ItemStatus>;
  /** TeamMember.id -> true. Project-level owners, set by a lead. Does not cascade to items. */
  projectAssignees: Record<string, true>;
  /** section key -> TeamMember.id. Either self-serve or assigned by a lead. */
  sectionAssignees: Record<string, string>;
  /**
   * section key -> TeamMember.id. Who reviews the section, independent of who answers it.
   *
   * These two are the only per-question-work assignment there is. Questions used to carry their own
   * `assignees`/`reviewers` maps as well, which meant one question could name a different owner than
   * the section it sits in, with nothing to say which of the two was meant. Work is handed out a
   * section at a time now, so a section-level choice is one value rather than a fan-out write to
   * every item in it.
   */
  sectionReviewers: Record<string, string>;
}

export interface TeamMember {
  id: string; // sanitized email, e.g. "alice@canonical_com"
  name: string;
  email: string;
  photoURL?: string;
}

export interface SavedFile {
  id: string;
  filename: string;
  data: ParsedQAFile;
  uploadedByName: string;
  uploadedByEmail: string;
  uploadedAt: number;
}

/**
 * Everything the dashboard needs about a project except its questions and answers.
 *
 * `itemCount` and `aiUnansweredIds` are the reason this type exists. The three status bands have to
 * sum to the project's item count, and deciding which items the AI left blank means running
 * `isUnanswered` over every answer — which would mean loading every project's full `data` into a
 * dashboard that may be showing thirty of them. Both are therefore computed once, when the file is
 * saved, and stored as metadata: a count and a list of short id strings, orders of magnitude smaller
 * than the answers they were derived from.
 */
export interface ProjectMeta {
  id: string;
  filename: string;
  uploadedByName: string;
  uploadedByEmail: string;
  uploadedAt: number;
  itemCount: number;
  /** Ids of items the AI left blank, as judged by `isUnanswered` at save time. */
  aiUnansweredIds: string[];
  /** ISO date string, or null when no due date has been set. */
  dueDate: string | null;
  /** Set once the project has been exported at least once; null before that. */
  exportedAt: number | null;
  exportedBy: string | null;
  exportedByEmail: string | null;
}

/**
 * The live overlay maps for one project, as the dashboard reads them.
 *
 * Deliberately excludes `data`, `contextUrls` and `sectionReviewers`: no band or badge on the
 * dashboard depends on them, and `data` is the payload this whole type exists to avoid transferring.
 * Every member here costs one live listener per project on screen, so a field earns its place by
 * being something the dashboard actually draws.
 *
 * `editedAnswers` carries answer text and is the one heavy member here. It is included because
 * without it a blank the AI left and a human has since filled cannot be told apart from one nobody
 * has touched — the difference between `ready` and `unanswered`. Only its keys are read.
 */
export interface ProjectOverlays {
  itemStatus: Record<string, ItemStatus>;
  editedAnswers: Record<string, string>;
  ratings: Record<string, number>;
  sectionAssignees: Record<string, string>;
  projectAssignees: Record<string, true>;
}

/** The three disjoint bands, plus the totals derived from them. */
export interface ProjectStats {
  itemCount: number;
  approved: number;
  ready: number;
  unanswered: number;
  /** Fraction 0–1 of items approved. 0 for an empty project rather than NaN. */
  approvedFraction: number;
  /** True once every item is approved. False for an empty project. */
  complete: boolean;
  editedCount: number;
  ratedCount: number;
}

/** A project's dashboard row: its metadata, its live overlays, and the stats derived from both. */
export interface ProjectSummary {
  meta: ProjectMeta;
  overlays: ProjectOverlays;
  stats: ProjectStats;
}

/**
 * An exported project's index entry, under `archivedProjects/index/<pushId>`.
 *
 * Split from its payload so the completed list can be listed without transferring the archived
 * documents themselves. See `lib/archive.ts` for why.
 */
export interface ArchivedProjectMeta {
  id: string;
  filename: string;
  exportedBy: string;
  exportedByEmail: string;
  exportedAt: number;
  itemCount: number;
  /** The `savedFiles` id this was exported from. May no longer exist. */
  sourceSessionId: string;
}

/** The heavy half of an archive entry, under `archivedProjects/payloads/<pushId>`. */
export interface ArchivedProjectPayload {
  data: ParsedQAFile;
  editedAnswers: Record<string, string>;
}

export interface RfpRecord {
  id: string;
  question: string;
  answer: string;
  source: string;
  rfpDate: string;
  importedAt: number;
}
