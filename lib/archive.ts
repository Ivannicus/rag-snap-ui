import { ref, get, update } from 'firebase/database';
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
 *
 * ## Why the entry is keyed by project, not pushed
 *
 * The entry id *is* `sourceSessionId`, so archiving the same project twice replaces its entry instead
 * of adding one. Export is also the way to re-download a CSV, so a `push` id meant a project
 * accumulated a row in "Completed & exported" — and a count in the summary strip — for every download
 * anyone ever took, permanently, since the archive is never pruned.
 *
 * Replacing means the latest export wins: `exportedAt` and `exportedBy` describe the most recent one,
 * and the payload matches the results as they stood then. That is the right answer for a list whose
 * job is to say where a finished project ended up.
 *
 * Ids stay collision-free after removal. Export-and-remove frees the `savedFiles` id, but the next
 * upload is a fresh `push` and never reuses it, so a later project cannot land on this entry.
 */
export async function archiveProject(input: ArchiveInput): Promise<string> {
  const id = input.sourceSessionId;
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
