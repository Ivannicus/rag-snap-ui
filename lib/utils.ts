import type { QAFile, QAItem, ParsedQAFile } from "./types";

/** Phrase that marks an answer as "not found in context" */
const UNANSWERED_PREFIX = "The provided context does not contain";

export function isUnanswered(answer: string): boolean {
  return answer.trimStart().startsWith(UNANSWERED_PREFIX);
}

/** Extract section number from an id like "1.2" → "1" */
export function sectionOf(id: string): string {
  return id.split(".")[0];
}

/** Get unique sorted section numbers from item list */
export function getSections(items: QAItem[]): string[] {
  const set = new Set(items.map((i) => sectionOf(i.id)));
  return Array.from(set).sort((a, b) => Number(a) - Number(b));
}

/** Parse and validate uploaded JSON */
export function parseQAFile(json: unknown): ParsedQAFile {
  if (typeof json !== "object" || json === null) {
    throw new Error("Invalid JSON: expected an object.");
  }
  const obj = json as QAFile;

  if (!obj.generated_at || !obj.model) {
    throw new Error('Missing required fields: "generated_at" and "model".');
  }

  const rawItems = obj.results ?? obj.result;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error('Missing or empty "results" array.');
  }

  const duplicateIds = new Set<string>();
  {
    const seen = new Set<string>();
    for (const item of rawItems) {
      if (seen.has(item.id)) duplicateIds.add(item.id);
      else seen.add(item.id);
    }
  }

  const idCounts = new Map<string, number>();
  const items: QAItem[] = rawItems.map((item, idx) => {
    if (!item.id || !item.question || item.answer === undefined) {
      throw new Error(
        `Item at index ${idx} is missing "id", "question", or "answer".`
      );
    }
    let id: string = item.id;
    if (duplicateIds.has(id)) {
      const count = (idCounts.get(id) ?? 0) + 1;
      idCounts.set(id, count);
      id = `${id}.${count}`;
    }
    return { id, question: item.question, answer: item.answer };
  });

  return { generated_at: obj.generated_at, model: obj.model, items };
}

/** Format ISO date string for display */
export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Group items by section, returning entries sorted by section number */
export function groupBySection(
  items: QAItem[]
): Array<{ section: string; items: QAItem[] }> {
  const map = new Map<string, QAItem[]>();
  for (const item of items) {
    const sec = sectionOf(item.id);
    if (!map.has(sec)) map.set(sec, []);
    map.get(sec)!.push(item);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([section, items]) => ({ section, items }));
}
