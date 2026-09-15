import { ref, push, set, get, remove, onValue, update, runTransaction } from 'firebase/database';
import { db } from './firebase';
import { isUnanswered } from './utils';
import type { ParsedQAFile, ProjectMeta, SavedFile } from './types';

/**
 * Shape of a single record under the `savedFiles` node.
 *
 * This interface is the only place the raw node shape is described. Everything outside this module
 * goes through `listDocs`, `subscribeToSavedFiles`, or `saveFile`, so a future split of the node
 * into separate metadata and data children can happen here without touching callers.
 */
interface StoredDoc {
  filename: string;
  data: ParsedQAFile;
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
 * Callers that only need to list or identify docs should use this rather than
 * `subscribeToSavedFiles`, which carries each doc's full `data`. Note that until the node is split
 * into metadata and data children, this still transfers the full node and discards `data` locally,
 * so it saves no bandwidth yet. It is the seam that split will hide behind.
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

    const items = stored.data?.items;
    const hasItems = Array.isArray(items);

    let itemCount = stored.itemCount;
    let aiUnansweredIds = stored.aiUnansweredIds;
    const backfill: Partial<StoredDoc> = {};

    if (itemCount === undefined && hasItems) {
      itemCount = items.length;
      backfill.itemCount = itemCount;
    }
    if (aiUnansweredIds === undefined && hasItems) {
      aiUnansweredIds = aiUnansweredIdsOf(stored.data);
      backfill.aiUnansweredIds = aiUnansweredIds;
    }

    // Per-record and transactional, rather than one multi-path `update` at the `savedFiles` root. The
    // root form recreated any record removed between this read and the write, as a partial holding
    // nothing but the two derived counts.
    if (Object.keys(backfill).length > 0) {
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

export function subscribeToSavedFiles(
  onUpdate: (files: SavedFile[]) => void
): () => void {
  const savedFilesRef = ref(db, 'savedFiles');
  // Returns onValue's own unsubscribe, which detaches exactly this callback. The previous
  // `off(savedFilesRef)` detached every listener at the path, so two overlapping subscriptions —
  // a React strict-mode double mount, or two mounted loaders — would take each other down and
  // leave the saved-file list frozen. Same fix as `subscribeToSession`.
  return onValue(savedFilesRef, (snapshot) => {
    const val = snapshot.val() as Record<string, StoredDoc> | null;
    const files: SavedFile[] = val
      ? Object.entries(val)
          .map(([id, v]) => ({
            id,
            filename: v.filename,
            data: v.data,
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
 */
export async function getSavedFile(id: string): Promise<SavedFile | null> {
  const snapshot = await get(ref(db, `savedFiles/${id}`));
  const stored = snapshot.val() as StoredDoc | null;
  if (!stored || !stored.data) return null;
  return {
    id,
    filename: stored.filename,
    data: stored.data,
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
  const snapshot = await get(ref(db, `savedFiles/${id}/data`));
  const data = snapshot.val() as ParsedQAFile | null;
  if (!data || !Array.isArray(data.items)) return null;

  const hash = await hashDoc(data);
  void update(ref(db, `savedFiles/${id}`), { contentHash: hash }).catch(() => {});
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

  const newRef = push(ref(db, 'savedFiles'));
  await set(newRef, {
    filename,
    data,
    uploadedByName,
    uploadedByEmail,
    uploadedAt: Date.now(),
    contentHash,
    // Denormalized now, while the data is in hand, so the dashboard never has to load it back.
    itemCount: data.items.length,
    aiUnansweredIds: aiUnansweredIdsOf(data),
  });
  return { ok: true, id: newRef.key as string };
}

export function removeSavedFile(fileId: string): Promise<void> {
  return remove(ref(db, `savedFiles/${fileId}`));
}
