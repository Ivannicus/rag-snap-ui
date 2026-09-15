export interface QAItem {
  id: string;
  question: string;
  answer: string;
  /**
   * Explicit section label, when the producer supplies one. Preferred over anything derived from
   * `id`. rag-cli calls this `source`; parseQAFile normalises both into this field.
   */
  section?: string;
}

/** One resolved section, real or inferred. `key` is what filters and grouping match on. */
export interface SectionInfo {
  key: string;
  label: string;
  /** True when we segmented by topic because the file carried no section signal. */
  inferred: boolean;
  count: number;
}

/** Resolved sections for a file, plus the item -> section lookup callers group by. */
export interface SectionMap {
  byItemId: Record<string, string>;
  sections: SectionInfo[];
}

/** An item as it appears on disk, before normalisation. */
export interface RawQAItem {
  id: string;
  question: string;
  answer: string;
  section?: string;
  /** rag-cli's name for the section label. */
  source?: string;
}

export interface QAFile {
  generated_at: string;
  model: string;
  /** Some files use "results", spec says "result" — we handle both */
  results?: RawQAItem[];
  result?: RawQAItem[];
}

export interface ParsedQAFile {
  generated_at: string;
  model: string;
  items: QAItem[];
}

/**
 * "answered" used to mean "the model produced an answer". Approval split that in two: an answer the
 * model produced is `ready`, and only a human clicking Approve makes it `approved`.
 */
export type FilterStatus = "all" | "approved" | "unanswered";

export interface Filters {
  status: FilterStatus;
  // "" = all sections; otherwise a SectionInfo.key (e.g. "1", "CP", "3~2", "inferred:4");
  // "assignee:<TeamMember.id>" / "reviewer:<TeamMember.id>" = the sections that member
  // is the assignee/reviewer of
  section: string;
  search: string;
}

export interface PersonFilterOption {
  value: string;
  label: string;
}

export interface SessionState {
  data: ParsedQAFile;
  filename: string;
  editedAnswers: Record<string, string>;
  ratings: Record<string, number>;
  contextUrls: Record<string, string>;
  // Human approvals, keyed by item.id. Present means approved; the key is removed to un-approve, so
  // there is no `false` to distinguish from absent. Editing an answer removes it — an approval
  // stands for the text that was read, not for the question.
  approvals: Record<string, true>;
  // Keyed by SectionInfo.key, not item.id — questions are not individually assignable. Stored
  // under the sectionAssignees/sectionReviewers RTDB nodes; the older item-keyed assignees/
  // reviewers nodes are obsolete and deliberately not read.
  sectionAssignees: Record<string, string>; // SectionInfo.key -> TeamMember.id
  sectionReviewers: Record<string, string>; // SectionInfo.key -> TeamMember.id
  /**
   * Which version of lib/sectioning.ts minted the keys the two maps above are stored against. Those
   * keys are algorithm output, so a session seeded under different rules keys its assignment to
   * sections this build does not produce. Undefined for a session written before the stamp existed.
   */
  sectionAlgoVersion?: number;
  /**
   * Whether the session still carries the obsolete item-keyed assignees/reviewers nodes. Set by
   * subscribeToSession from the raw snapshot; never written back. Rooms from before assignment moved
   * to sections predate sectionAlgoVersion too, so this is the only signal that their empty
   * assignment is data this build declines to read rather than work nobody has done.
   */
  hasLegacyItemAssignment?: boolean;
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

export interface RfpRecord {
  id: string;
  question: string;
  answer: string;
  source: string;
  rfpDate: string;
  importedAt: number;
}
