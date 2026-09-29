import { ref, get, update } from 'firebase/database';
import { db } from './firebase';
import type {
  ArchivedProjectMeta,
  ArchivedProjectPayload,
  DealStatus,
  ParsedQAFile,
} from './types';

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

  // The index fields are written one path each rather than as one object at `index/<id>`.
  //
  // That is not a style choice. An `update` whose value is a whole object *replaces* that child, and
  // because this entry is keyed by project, re-exporting overwrites the entry it already had — which
  // would silently discard `dealStatus`, a field this function does not know about and has no business
  // resetting. Per-field paths merge, so the reported status survives a re-export.
  //
  // `payloads/<id>` stays a whole-object write: it is the document, and a fresh export replaces it
  // entirely by design. Both halves are still one atomic `update`, so an entry cannot be listed
  // without its payload.
  await update(ref(db, 'archivedProjects'), {
    [`index/${id}/filename`]: input.filename,
    [`index/${id}/exportedBy`]: input.exportedBy,
    [`index/${id}/exportedByEmail`]: input.exportedByEmail,
    [`index/${id}/exportedAt`]: exportedAt,
    [`index/${id}/itemCount`]: input.data.items.length,
    [`index/${id}/sourceSessionId`]: input.sourceSessionId,
    [`payloads/${id}`]: {
      data: input.data,
      // RTDB drops empty objects, so an unedited project simply has no `editedAnswers` child. The
      // reader defaults it rather than treating its absence as a broken entry.
      editedAnswers: input.editedAnswers,
    },
  });

  return id;
}

/** The three reportable outcomes, and the only values ever written to `dealStatus`. */
const DEAL_STATUSES: readonly DealStatus[] = ['won', 'lost', 'pending'];

function toDealStatus(value: unknown): DealStatus {
  // Anything unrecognised — absent, or a value from some future build — reads as pending rather than
  // being trusted into the type. A status nobody has set and a status this build cannot interpret are
  // the same thing from here: not reported.
  return DEAL_STATUSES.includes(value as DealStatus) ? (value as DealStatus) : 'pending';
}

/** One-shot read of the completed-project list, newest export first. Carries no documents. */
export async function listArchivedProjects(): Promise<ArchivedProjectMeta[]> {
  const snapshot = await get(ref(db, 'archivedProjects/index'));
  const val = snapshot.val() as Record<string, Partial<ArchivedProjectMeta>> | null;
  if (!val) return [];
  return Object.entries(val)
    // An entry with no filename or no export time is not a completed project. Same guard as
    // `listProjectMetas`, and for the same reason: `setDealStatus` writes with `update`, which creates
    // the node when it is absent, so an entry deleted out from under a status change would otherwise
    // come back as a row holding nothing but its outcome.
    .filter(([, entry]) => typeof entry.filename === 'string' && typeof entry.exportedAt === 'number')
    .map(([id, entry]) => ({
      id,
      filename: entry.filename as string,
      exportedBy: entry.exportedBy ?? 'Unknown',
      exportedByEmail: entry.exportedByEmail ?? '',
      exportedAt: entry.exportedAt as number,
      itemCount: entry.itemCount ?? 0,
      sourceSessionId: entry.sourceSessionId ?? id,
      dealStatus: toDealStatus(entry.dealStatus),
    }))
    .sort((a, b) => b.exportedAt - a.exportedAt);
}

/**
 * Report where a completed project's deal ended up.
 *
 * One field on the index entry, so it costs nothing to read back with the list and never touches the
 * payload. Writing `"pending"` stores it explicitly rather than clearing the child — the read defaults
 * a missing one to pending anyway, so the two are equivalent, and an explicit value is the honest record
 * of somebody having actively set it back.
 */
export function setDealStatus(archiveId: string, status: DealStatus): Promise<void> {
  return update(ref(db, `archivedProjects/index/${archiveId}`), { dealStatus: status });
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
