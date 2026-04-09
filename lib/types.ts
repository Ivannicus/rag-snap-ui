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
  section: string; // "" means all sections
  search: string;
}
