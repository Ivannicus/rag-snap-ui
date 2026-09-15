import { ref, push, get, onValue, update, runTransaction } from 'firebase/database';
import { db } from './firebase';
import { isUnanswered } from './utils';
import type { ParsedQAFile, ProjectMeta, SavedFile, SavedFileMeta } from './types';

/**
 * Where a document's questions and answers live, keyed by the same id as its `savedFiles` record.
 *
 * ## Why it is not in the record
 *
 * RTDB hands back the entire subtree under any path you read, so listing the bank by reading
 * `savedFiles` transferred every document in it — and `subscribeToSavedFiles` did that live, again on
 * every upload, removal, due-date edit and export stamp. `itemCount` and `aiUnansweredIds` were
 * denormalized onto the record precisely so the dashboard could size a project's status bands without
 * its document, and then the read that used them pulled every document anyway.
 *
 * Split into a sibling, listing reads only short records, and a document is fetched at the moment
 * someone opens one. A child of the record would not have done: nesting changes nothing about what a
 * read of the parent returns. Only reading a different path does.
 *
 * The two are written and removed together in single multi-path operations at the root, so a record
 * cannot exist without its document or outlive it.
 */
const DATA_ROOT = 'savedFileData';

/**
 * Shape of a single record under the `savedFiles` node.
 *
 * This interface is the only place the raw node shape is described. Everything outside this module
 * goes through `listDocs`, `subscribeToSavedFiles`, `getSavedFile` or `saveFile`.
 */
interface StoredDoc {
  filename: string;
  /**
   * Legacy only: where the document used to live, before it moved to `savedFileData/<id>`. Records
   * written since the split have no `data` child, and `listProjectMetas` migrates the ones that do.
   * Read through `getSavedFile`, never directly.
   */
  data?: ParsedQAFile;
  uploadedByName: string;
  uploadedByEmail: string;
  uploadedAt: number;
  /** Absent on records written before content hashing was introduced. */
  contentHash?: string;
  /**
   * Denormalized from `data`, so the dashboard can size a project's status bands without loading its
   * questions and answers. Both absent on records written before the dashboard existed;
   * `listProjectMetas` computes and backfills them.
   */
  itemCount?: number;
  aiUnansweredIds?: string[];
  /** ISO date string. Absent when no due date has been set. */
  dueDate?: string;
  /** Absent until the project has been exported at least once. */
  exportedAt?: number;
  exportedBy?: string;
  exportedByEmail?: string;
}

/** Lightweight per-doc metadata, with no `data` payload. */
export interface DocMeta {
  id: string;
  filename: string;
  uploadedAt: number;
  /** null for records saved before content hashing was introduced. */
  contentHash: string | null;
}

/**
 * Outcome of a save attempt.
 *
 * The two rejections are deliberately separate, because they call for opposite handling. `duplicate`
 * means an existing doc holds this exact content, so opening `existingId` shows the caller the very
 * questions and answers they just uploaded. `filenameConflict` means a *different* doc already owns
 * this filename: opening it would show content the caller did not upload, so there is nothing safe
 * to open and the collision has to be surfaced instead.
 */
export type SaveFileResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'duplicate'; existingId: string }
  | { ok: false; reason: 'filenameConflict'; existingId: string };

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Serialize to JSON with every object's keys in sorted order, so that two structurally equal values
 * always produce byte-identical output. `JSON.stringify` preserves insertion order instead, which
 * means the same document parsed from differently ordered JSON would otherwise serialize
 * differently and hash differently.
 */
function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`);
  return `{${entries.join(',')}}`;
}

/**
 * Content hash of a parsed doc, used to detect a re-upload of the same content under a different
 * filename.
 *
 * SHA-256 via Web Crypto: collision resistant (a false positive here would reject a legitimate
 * upload, so a short non-cryptographic hash is not good enough) and built into the platform, so it
 * adds no dependency. `crypto.subtle` needs a secure context, which both https hosting and
 * localhost dev satisfy.
 *
 * `generated_at` is deliberately excluded. It records when the batch was produced, not what it
 * says, so including it would give the same questions and answers a different hash on every run and
 * make this check little more than a byte-equality test that the filename check already covers.
 * `model` is included, because the same questions answered by a different model is different
 * content. Items are sorted by id so that reordering them does not change the hash.
 */
export async function hashDoc(data: ParsedQAFile): Promise<string> {
  const items = [...data.items]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((item) => ({ id: item.id, question: item.question, answer: item.answer }));
  const canonical = canonicalize({ model: data.model, items });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function toDocMeta(id: string, stored: StoredDoc): DocMeta {
  return {
    id,
    filename: stored.filename,
    uploadedAt: stored.uploadedAt,
    contentHash: stored.contentHash ?? null,
  };
}

/**
 * One-shot read of every saved doc's metadata, newest first.
 *
 * Cheap since documents moved to `savedFileData` — see `DATA_ROOT`. Legacy records that still carry an
 * inline `data` child are the exception, and `listProjectMetas` migrates those as it meets them.
 */
export async function listDocs(): Promise<DocMeta[]> {
  const snapshot = await get(ref(db, 'savedFiles'));
  const val = snapshot.val() as Record<string, StoredDoc> | null;
  if (!val) return [];
  return Object.entries(val)
    .map(([id, stored]) => toDocMeta(id, stored))
    .sort((a, b) => b.uploadedAt - a.uploadedAt);
}

/** The ids the AI left blank, by the same test the inspector uses to colour a card. */
function aiUnansweredIdsOf(data: ParsedQAFile): string[] {
  return data.items.filter((item) => isUnanswered(item.answer)).map((item) => item.id);
}

/**
 * One-shot read of every project's dashboard metadata, newest first.
 *
 * This is the dashboard's only read of `savedFiles`, and it is one-shot on purpose. `savedFiles`
 * records carry their full `data`, so a live listener here would re-transfer every project's
 * questions and answers on every upload, removal, due-date edit and export stamp. The project list
 * changes rarely and only through actions the app itself takes, so it is re-read when the dashboard
 * is opened and after those actions instead of being watched. The per-project *overlays*, which
 * change constantly and are small, are what get live listeners — see `lib/projects.ts`.
 *
 * Records predating the dashboard have no `itemCount` or `aiUnansweredIds`. Both are derived here
 * from the `data` this read already holds and written back, so each legacy record is computed at
 * most once. That write is deliberately not awaited and its failure ignored, for the same reason
 * `storedContentHash` ignores its own: it is a cache fill, and losing it costs one recomputation
 * next time rather than a wrong answer now.
 */
export async function listProjectMetas(): Promise<ProjectMeta[]> {
  const snapshot = await get(ref(db, 'savedFiles'));
  const val = snapshot.val() as Record<string, StoredDoc> | null;
  if (!val) return [];

  const metas: ProjectMeta[] = [];

  for (const [id, stored] of Object.entries(val)) {
    // A record with no filename or no upload time is not a project. It is the residue of a write that
    // landed on an id nothing lives at any more — see `updateExistingDoc` for how that used to happen
    // — and it has nothing a card could be drawn from. Skipping it here keeps one bad record from
    // reaching the dashboard at all, rather than relying on every renderer downstream to survive it.
    if (typeof stored.filename !== 'string' || typeof stored.uploadedAt !== 'number') continue;

    // An inline `data` child means a record written before the split. It is the only reason this read
    // is ever expensive, and the only chance to fix that is while the document is in hand.
    const legacyData = stored.data;
    const items = legacyData?.items;
    const hasItems = Array.isArray(items);

    let itemCount = stored.itemCount;
    let aiUnansweredIds = stored.aiUnansweredIds;
    const backfill: Partial<StoredDoc> = {};

    if (itemCount === undefined && hasItems) {
      itemCount = items.length;
      backfill.itemCount = itemCount;
    }
    if (aiUnansweredIds === undefined && hasItems && legacyData) {
      aiUnansweredIds = aiUnansweredIdsOf(legacyData);
      backfill.aiUnansweredIds = aiUnansweredIds;
    }

    if (legacyData && hasItems) {
      // Move the document out, and record the two derived counts on the way, so this record never
      // costs a full transfer again. Fire-and-forget, like the `contentHash` fill: it is a migration,
      // and losing it costs one more expensive read rather than a wrong answer now.
      void migrateInlineData(id, legacyData, backfill).catch(() => {});
    } else if (Object.keys(backfill).length > 0) {
      // Per-record and transactional, rather than one multi-path `update` at the `savedFiles` root. The
      // root form recreated any record removed between this read and the write, as a partial holding
      // nothing but the two derived counts.
      void updateExistingDoc(id, backfill).catch(() => {});
    }

    metas.push({
      id,
      filename: stored.filename,
      uploadedByName: stored.uploadedByName,
      uploadedByEmail: stored.uploadedByEmail,
      uploadedAt: stored.uploadedAt,
      itemCount: itemCount ?? 0,
      aiUnansweredIds: aiUnansweredIds ?? [],
      dueDate: stored.dueDate ?? null,
      exportedAt: stored.exportedAt ?? null,
      exportedBy: stored.exportedBy ?? null,
      exportedByEmail: stored.exportedByEmail ?? null,
    });
  }

  return metas.sort((a, b) => b.uploadedAt - a.uploadedAt);
}

/**
 * Merge fields into an existing record, and do nothing at all if there is no such record.
 *
 * `update` is not safe for this: RTDB creates the node when it is absent, so editing a project that
 * someone else removed since the dashboard was read wrote a *new* record holding only the edited
 * fields — no filename, no `uploadedAt`, no document. That partial came back on the next
 * `listProjectMetas` as a project with no name and an undefined upload time.
 *
 * A transaction is the fix rather than a read-then-write, because the removal can land between the
 * two. Returning `undefined` from the handler aborts, which is how "leave it alone" is expressed;
 * `ensureSession` uses the same shape to seed a room without disturbing an existing one.
 *
 * A field set to `undefined` is deleted rather than written. RTDB rejects an `undefined` value
 * outright, so a spread carrying one would fail the whole write — which is what clearing a due date
 * would otherwise do.
 */
function updateExistingDoc(fileId: string, fields: Partial<StoredDoc>): Promise<void> {
  return runTransaction(ref(db, `savedFiles/${fileId}`), (current: StoredDoc | null) => {
    if (current === null) return undefined;
    const next = { ...current };
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) delete next[key as keyof StoredDoc];
      else Object.assign(next, { [key]: value });
    }
    return next;
  }).then(() => undefined);
}

/**
 * Move one legacy record's document to `savedFileData/<id>`, and stamp any derived counts with it.
 *
 * One multi-path `update` at the root, so the write to the new location and the clearing of the old
 * one commit together: there is no instant at which the document exists in neither place.
 *
 * Racing a removal can leave an orphan under `savedFileData` and a partial record behind, the same
 * narrow window every fire-and-forget fill in this module has. Neither is load-bearing —
 * `listProjectMetas` skips a record too partial to draw, and an orphaned document is unreachable
 * because nothing can name its id — so the cost is wasted bytes, not a wrong answer.
 */
function migrateInlineData(
  fileId: string,
  data: ParsedQAFile,
  derived: Partial<StoredDoc>
): Promise<void> {
  const writes: Record<string, unknown> = {
    [`${DATA_ROOT}/${fileId}`]: data,
    [`savedFiles/${fileId}/data`]: null,
  };
  for (const [key, value] of Object.entries(derived)) {
    writes[`savedFiles/${fileId}/${key}`] = value;
  }
  return update(ref(db), writes);
}

/** Set or clear a project's due date. Pass null to clear. */
export function setDueDate(fileId: string, isoDate: string | null): Promise<void> {
  return updateExistingDoc(fileId, { dueDate: isoDate ?? undefined });
}

/**
 * Stamp a project as exported.
 *
 * Recorded on the `savedFiles` record rather than only in the archive so that a project which was
 * exported but deliberately kept in the shared list can still be told apart, on the dashboard, from
 * one nobody has exported yet.
 */
export function markExported(
  fileId: string,
  exportedBy: string,
  exportedByEmail: string,
  exportedAt: number
): Promise<void> {
  return updateExistingDoc(fileId, { exportedAt, exportedBy, exportedByEmail });
}

/**
 * Watch the saved-doc list. Metadata only — call `getSavedFile` to open one.
 *
 * This is the live listener the split in `DATA_ROOT` matters most for. Carrying `data`, it re-sent
 * every document in the bank to every open file loader on each upload, removal, due-date edit and
 * export stamp.
 */
export function subscribeToSavedFiles(
  onUpdate: (files: SavedFileMeta[]) => void
): () => void {
  const savedFilesRef = ref(db, 'savedFiles');
  // Returns onValue's own unsubscribe, which detaches exactly this callback. The previous
  // `off(savedFilesRef)` detached every listener at the path, so two overlapping subscriptions —
  // a React strict-mode double mount, or two mounted loaders — would take each other down and
  // leave the saved-file list frozen. Same fix as `subscribeToSession`.
  return onValue(savedFilesRef, (snapshot) => {
    const val = snapshot.val() as Record<string, StoredDoc> | null;
    const files: SavedFileMeta[] = val
      ? Object.entries(val)
          // Same guard as `listProjectMetas`: a record too partial to name is not a doc.
          .filter(([, v]) => typeof v.filename === 'string' && typeof v.uploadedAt === 'number')
          .map(([id, v]) => ({
            id,
            filename: v.filename,
            uploadedByName: v.uploadedByName,
            uploadedByEmail: v.uploadedByEmail,
            uploadedAt: v.uploadedAt,
          }))
          .sort((a, b) => b.uploadedAt - a.uploadedAt)
      : [];
    onUpdate(files);
  });
}

/**
 * One-shot read of a single saved doc, or null if there is no doc with that id.
 *
 * This is what makes a shared `?doc=` link work: the content of a doc lives here, independently of
 * the collaboration room, so a tab that arrives holding nothing but an id can fetch what to show
 * instead of waiting on a room snapshot that may never come.
 *
 * Two reads, because the document is a sibling of its record now. They run together: neither depends
 * on the other, and this is on the path a reader waits behind when they open something.
 *
 * `stored.data` is the fallback for a record written before the split which `listProjectMetas` has not
 * migrated yet — that migration is fire-and-forget, so a link can arrive first.
 */
export async function getSavedFile(id: string): Promise<SavedFile | null> {
  const [recordSnapshot, dataSnapshot] = await Promise.all([
    get(ref(db, `savedFiles/${id}`)),
    get(ref(db, `${DATA_ROOT}/${id}`)),
  ]);
  const stored = recordSnapshot.val() as StoredDoc | null;
  if (!stored) return null;

  const data = (dataSnapshot.val() as ParsedQAFile | null) ?? stored.data;
  if (!data || !Array.isArray(data.items)) return null;

  return {
    id,
    data,
    filename: stored.filename,
    uploadedByName: stored.uploadedByName,
    uploadedByEmail: stored.uploadedByEmail,
    uploadedAt: stored.uploadedAt,
  };
}

/**
 * Content hash of an already-stored doc, or null if its data cannot be read.
 *
 * Only needed for records written before `contentHash` existed, which is every record saved before
 * this feature landed. Without this, the first upload of an existing doc after the upgrade would
 * match on filename with no hash to compare against, and would have to be treated as a collision —
 * making a doc that is already in the bank look like a conflict with itself.
 *
 * The hash is written back to the record as a side effect, so each legacy doc is read and hashed at
 * most once. That write is deliberately not awaited and its failure deliberately ignored: it is a
 * cache fill, and losing it costs one repeated read next time rather than a wrong answer now.
 */
async function storedContentHash(id: string): Promise<string | null> {
  // Through `getSavedFile`, so this follows the document wherever it lives — the new sibling path, or
  // still inline on a record the migration has not reached.
  const saved = await getSavedFile(id);
  if (!saved) return null;

  const hash = await hashDoc(saved.data);
  void updateExistingDoc(id, { contentHash: hash }).catch(() => {});
  return hash;
}

interface SaveFileInput {
  filename: string;
  data: ParsedQAFile;
  uploadedByName: string;
  uploadedByEmail: string;
}

/**
 * Save a doc, unless one with the same content, or one already using this filename, exists.
 *
 * Neither rejection is a failure, so both come back as an `ok: false` result; only genuine write and
 * hashing failures reject. What matters is which one it is. Content is the thing that decides
 * identity, so it is checked first and on its own: a matching hash means the bank already holds this
 * doc, whatever it happens to be called, and `existingId` is safe to open. Only once content has
 * ruled itself out does the filename matter, and then it means the opposite — a *different* doc is
 * using this name, so `existingId` holds content the caller never uploaded and must not be opened as
 * though it were theirs. Collapsing the two into one `duplicate` result is what let a re-upload
 * under a reused name open a room belonging to unrelated content.
 *
 * The check compares against `listDocs` metadata and the hash stored on each record at write time,
 * so it does not re-hash existing docs — except for records predating `contentHash`, which
 * `storedContentHash` resolves once each.
 */
export async function saveFile({
  filename,
  data,
  uploadedByName,
  uploadedByEmail,
}: SaveFileInput): Promise<SaveFileResult> {
  const contentHash = await hashDoc(data);
  const existing = await listDocs();

  const sameContent = existing.find((doc) => doc.contentHash === contentHash);
  if (sameContent) return { ok: false, reason: 'duplicate', existingId: sameContent.id };

  // Records with no stored hash cannot be ruled out by the check above, so any of them sharing this
  // filename has to be hashed before its name can be called a conflict.
  const sameName = existing.filter((doc) => doc.filename === filename);
  for (const doc of sameName) {
    const knownHash = doc.contentHash ?? (await storedContentHash(doc.id));
    if (knownHash === contentHash) return { ok: false, reason: 'duplicate', existingId: doc.id };
  }
  if (sameName.length > 0) {
    return { ok: false, reason: 'filenameConflict', existingId: sameName[0].id };
  }

  // `push` for the id only; nothing is written at that ref. The record and the document are two paths
  // now, so both go in one multi-path `update` at the root and commit together — a record can never be
  // listed without a document behind it.
  const id = push(ref(db, 'savedFiles')).key as string;
  await update(ref(db), {
    [`savedFiles/${id}`]: {
      filename,
      uploadedByName,
      uploadedByEmail,
      uploadedAt: Date.now(),
      contentHash,
      // Denormalized now, while the data is in hand, so the dashboard never has to load it back.
      itemCount: data.items.length,
      aiUnansweredIds: aiUnansweredIdsOf(data),
    },
    [`${DATA_ROOT}/${id}`]: data,
  });
  return { ok: true, id };
}

/**
 * Remove a doc and its document together.
 *
 * One multi-path `update` of nulls rather than two `remove` calls, so a failure cannot leave the
 * document behind as an orphan nothing can name, or leave a record pointing at a document that is gone.
 */
export function removeSavedFile(fileId: string): Promise<void> {
  return update(ref(db), {
    [`savedFiles/${fileId}`]: null,
    [`${DATA_ROOT}/${fileId}`]: null,
  });
}
