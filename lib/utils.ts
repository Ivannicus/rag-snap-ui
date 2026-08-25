import type { QAFile, QAItem, ParsedQAFile, SectionInfo, SectionMap } from "./types";

/** Phrase that marks an answer as "not found in context" */
const UNANSWERED_PREFIX = "The provided context does not contain";

export function isUnanswered(answer: string): boolean {
  return answer.trimStart().startsWith(UNANSWERED_PREFIX);
}

/** Sections available for the filter dropdown, in resolved order. */
export function getSections(map: SectionMap): SectionInfo[] {
  return map.sections;
}

/** The section key an item belongs to, per the resolved map. */
export function sectionKeyOf(map: SectionMap, item: QAItem): string {
  return map.byItemId[item.id] ?? "";
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
    // Keep an explicit section label if the producer sent one, under either name. Without this
    // the only section signal left is the id, which flat-id files do not carry.
    const section = item.section ?? item.source;
    return {
      id,
      question: item.question,
      answer: item.answer,
      ...(typeof section === "string" && section.trim() ? { section } : {}),
    };
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

/**
 * Group items into their resolved sections, in the map's order, dropping sections that no item
 * survives the current filters in.
 *
 * The map is looked up, never recomputed: pass the map resolved once from the full file so the
 * section a question sits in cannot change as the user filters.
 */
export function groupBySection(
  items: QAItem[],
  map: SectionMap
): Array<{ section: SectionInfo; items: QAItem[] }> {
  const buckets = new Map<string, QAItem[]>();
  for (const item of items) {
    const key = sectionKeyOf(map, item);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(item);
  }
  return map.sections
    .filter((section) => buckets.has(section.key))
    .map((section) => ({ section, items: buckets.get(section.key)! }));
}
