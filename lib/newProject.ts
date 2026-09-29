import { parseQAFile } from './utils';
import { auth } from './firebase';
import { saveFile, type SaveFileResult } from './savedFiles';
import type { ParsedQAFile } from './types';

/**
 * Creating a project, in the two steps the UI needs it in.
 *
 * These used to be one function inside `FileLoader`, which was the only thing that could make a
 * project. Creation is now started from two places — the dashboard's New project button and the
 * renamed Projects dropdown — and both have to configure a due date and a team in between reading the
 * file and saving it. Splitting reading from saving is what makes that gap possible: the file is
 * parsed first, so an unreadable one is refused before anybody is asked to configure it, and the save
 * happens on submit with the answers in hand.
 */

/**
 * Read a picked file and parse it, or reject with a message fit to show the user.
 *
 * The extension guard, the `FileReader` and the `parseQAFile` call are lifted from `FileLoader` as
 * they stood, including their wording, so the failures a reader may already have seen are unchanged.
 */
export function readJsonFile(file: File): Promise<ParsedQAFile> {
  return new Promise((resolve, reject) => {
    if (!file.name.endsWith('.json')) {
      reject(new Error('Please select a .json file.'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That file could not be read. Try selecting it again.'));
    reader.onload = (e) => {
      try {
        resolve(parseQAFile(JSON.parse(e.target?.result as string)));
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Failed to parse file.'));
      }
    };
    reader.readAsText(file);
  });
}

export interface CreateProjectInput {
  filename: string;
  data: ParsedQAFile;
  /** ISO at UTC midnight, or null for a project with no due date. */
  dueDate: string | null;
}

/**
 * Save a new project, due date and all.
 *
 * The one writer of the `savedFiles` record on this path. It returns `saveFile`'s result untouched,
 * because the caller has to tell the three outcomes apart: a `duplicate` means this exact document is
 * already in the bank and there is nothing to create, a `filenameConflict` means a *different*
 * document owns the name, and only `ok` has an id worth opening.
 *
 * Note it takes no owners. Those belong to the *session*, not the record, and go in through
 * `newSessionState` at seed time — `ensureSession`'s transaction aborts against a node that already
 * exists, so a separate `projectAssignees` write here would break the room it was trying to staff.
 */
export function createProject({
  filename,
  data,
  dueDate,
}: CreateProjectInput): Promise<SaveFileResult> {
  return saveFile({
    filename,
    data,
    uploadedByName: auth.currentUser?.displayName ?? auth.currentUser?.email ?? 'Unknown',
    uploadedByEmail: auth.currentUser?.email ?? '',
    dueDate,
  });
}
