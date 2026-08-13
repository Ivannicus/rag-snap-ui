import { ref, push, set, get, remove, onValue, off } from 'firebase/database';
import { db } from './firebase';
import type { ParsedQAFile, SavedFile } from './types';

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
}

/** Lightweight per-doc metadata, with no `data` payload. */
export interface DocMeta {
  id: string;
  filename: string;
  uploadedAt: number;
  /** null for records saved before content hashing was introduced. */
  contentHash: string | null;
}

export type SaveFileResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'duplicate'; existingId: string };

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

export function subscribeToSavedFiles(
  onUpdate: (files: SavedFile[]) => void
): () => void {
  const savedFilesRef = ref(db, 'savedFiles');
  onValue(savedFilesRef, (snapshot) => {
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
  return () => off(savedFilesRef);
}

interface SaveFileInput {
  filename: string;
  data: ParsedQAFile;
  uploadedByName: string;
  uploadedByEmail: string;
}

/**
 * Save a doc, unless one with the same filename or the same content already exists.
 *
 * A duplicate is a normal outcome rather than a failure, so it comes back as
 * `{ ok: false, reason: 'duplicate', existingId }`; only genuine write and hashing failures reject.
 * `existingId` is the doc that already holds this content, which callers need in order to open that
 * doc rather than leaving the view attached to nothing.
 *
 * The check compares against `listDocs` metadata, and the hash is stored on the record at write
 * time, so deciding whether a doc is a duplicate never has to re-hash existing docs.
 */
export async function saveFile({
  filename,
  data,
  uploadedByName,
  uploadedByEmail,
}: SaveFileInput): Promise<SaveFileResult> {
  const contentHash = await hashDoc(data);
  const existing = await listDocs();

  const duplicate = existing.find(
    (doc) =>
      doc.filename === filename ||
      (doc.contentHash !== null && doc.contentHash === contentHash)
  );
  if (duplicate) return { ok: false, reason: 'duplicate', existingId: duplicate.id };

  const newRef = push(ref(db, 'savedFiles'));
  await set(newRef, {
    filename,
    data,
    uploadedByName,
    uploadedByEmail,
    uploadedAt: Date.now(),
    contentHash,
  });
  return { ok: true, id: newRef.key as string };
}

export function removeSavedFile(fileId: string): Promise<void> {
  return remove(ref(db, `savedFiles/${fileId}`));
}
