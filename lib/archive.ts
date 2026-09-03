import { ref, push, get, update } from 'firebase/database';
import { db } from './firebase';
import type { ArchivedProjectMeta, ArchivedProjectPayload, ParsedQAFile } from './types';

/**
 * The permanent record of exported projects.
 *
 * A `savedFiles` record can be removed on export, taking the document with it, so the archive is
 * what lets the dashboard still list a completed project — and still regenerate its CSV — after that.
 *
 * ## Why the node is split in two
 *
 * An entry's fields are stored across two children of `archivedProjects`:
 *
 *   archivedProjects/index/<pushId>    -> filename, exportedBy, exportedByEmail, exportedAt,
 *                                         itemCount, sourceSessionId
 *   archivedProjects/payloads/<pushId> -> data, editedAnswers
 *
 * RTDB returns a whole subtree for any path you read, so nesting alone saves nothing — only reading a
 * *different path* does. Held flat in one record per entry, listing the completed projects would mean
 * transferring every archived document in full, and unlike `savedFiles` the archive is never pruned,
 * so that cost grows without bound for the life of the app. Split, the list reads `index` and stays
 * small forever, and a document is fetched only when someone actually asks to re-download it.
 *
 * The two are written together in a single multi-path `update`, so an entry cannot appear in the list
 * without its payload.
 */

interface ArchiveInput {
  filename: string;
  exportedBy: string;
  exportedByEmail: string;
  data: ParsedQAFile;
  editedAnswers: Record<string, string>;
  /** The `savedFiles` id this was exported from. May be removed afterwards. */
  sourceSessionId: string;
}

/**
 * Archive an exported project. Returns the archive entry's id.
 *
 * Called on both export paths — plain export and export-and-remove — because "this project was
 * finished and its results taken away" is the same event either way, and only one of those paths
 * leaves anything behind in `savedFiles` to remember it by.
 */
export async function archiveProject(input: ArchiveInput): Promise<string> {
  const entryRef = push(ref(db, 'archivedProjects/index'));
  const id = entryRef.key as string;
  const exportedAt = Date.now();

  await update(ref(db, 'archivedProjects'), {
    [`index/${id}`]: {
      filename: input.filename,
      exportedBy: input.exportedBy,
      exportedByEmail: input.exportedByEmail,
      exportedAt,
      itemCount: input.data.items.length,
      sourceSessionId: input.sourceSessionId,
    },
    [`payloads/${id}`]: {
      data: input.data,
      // RTDB drops empty objects, so an unedited project simply has no `editedAnswers` child. The
      // reader defaults it rather than treating its absence as a broken entry.
      editedAnswers: input.editedAnswers,
    },
  });

  return id;
}

/** One-shot read of the completed-project list, newest export first. Carries no documents. */
export async function listArchivedProjects(): Promise<ArchivedProjectMeta[]> {
  const snapshot = await get(ref(db, 'archivedProjects/index'));
  const val = snapshot.val() as Record<string, Omit<ArchivedProjectMeta, 'id'>> | null;
  if (!val) return [];
  return Object.entries(val)
    .map(([id, entry]) => ({
      id,
      filename: entry.filename,
      exportedBy: entry.exportedBy,
      exportedByEmail: entry.exportedByEmail,
      exportedAt: entry.exportedAt,
      itemCount: entry.itemCount,
      sourceSessionId: entry.sourceSessionId,
    }))
    .sort((a, b) => b.exportedAt - a.exportedAt);
}

/**
 * Fetch one archived document, for regenerating its CSV. Null if the payload is missing.
 *
 * This is the only read in the app that pulls an archived document, and it happens on an explicit
 * click rather than as part of rendering a list.
 */
export async function getArchivedPayload(
  archiveId: string
): Promise<ArchivedProjectPayload | null> {
  const snapshot = await get(ref(db, `archivedProjects/payloads/${archiveId}`));
  const val = snapshot.val() as Partial<ArchivedProjectPayload> | null;
  if (!val?.data || !Array.isArray(val.data.items)) return null;
  return { data: val.data, editedAnswers: val.editedAnswers ?? {} };
}
