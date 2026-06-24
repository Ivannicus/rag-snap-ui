import { ref, push, set, remove, onValue, off } from 'firebase/database';
import { db } from './firebase';
import type { ParsedQAFile, SavedFile } from './types';

export function subscribeToSavedFiles(
  onUpdate: (files: SavedFile[]) => void
): () => void {
  const savedFilesRef = ref(db, 'savedFiles');
  onValue(savedFilesRef, (snapshot) => {
    const val = snapshot.val();
    const files: SavedFile[] = val
      ? Object.entries(
          val as Record<
            string,
            {
              filename: string;
              data: ParsedQAFile;
              uploadedByName: string;
              uploadedByEmail: string;
              uploadedAt: number;
            }
          >
        )
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

// Always creates a new entry — re-uploading a file with the same name never overwrites an existing one.
export async function saveFile({
  filename,
  data,
  uploadedByName,
  uploadedByEmail,
}: SaveFileInput): Promise<string> {
  const newRef = push(ref(db, 'savedFiles'));
  await set(newRef, {
    filename,
    data,
    uploadedByName,
    uploadedByEmail,
    uploadedAt: Date.now(),
  });
  return newRef.key as string;
}

export function removeSavedFile(fileId: string): Promise<void> {
  return remove(ref(db, `savedFiles/${fileId}`));
}
