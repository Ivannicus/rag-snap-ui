import { markExported } from './savedFiles';
import { archiveProject } from './archive';
import { buildCsv, csvFilenameFor, downloadCsv } from './csv';
import { auth } from './firebase';
import type { ParsedQAFile } from './types';

/**
 * Everything an export needs, gathered by whoever is doing the exporting.
 *
 * The header's `ExportButton` has all of it already — it is the open document's toolbar. The file
 * loader's per-row export has none of it and fetches it first (`getSavedFile` plus
 * `getSessionOverlays`), which is the only difference between the two paths.
 */
export interface ProjectExportInput {
  data: ParsedQAFile;
  editedAnswers: Record<string, string>;
  ratings: Record<string, number>;
  contextUrls: Record<string, string>;
  /** The *source* JSON name. The CSV name is derived from it — see `csvFilenameFor`. */
  sourceFilename: string | null;
  /** Saved-file id. Null for a document that never came from the bank: nothing to archive or stamp. */
  docId: string | null;
}

export interface ProjectExportResult {
  /** Whether the download was *initiated* — see `downloadCsv` for why that is the strongest signal. */
  downloaded: boolean;
  /** What the browser was told to save it as. */
  downloadName: string;
  /**
   * Settles with the archive write. Null when there was no `docId` to archive under.
   *
   * Handed back rather than swallowed because the two callers word its failure differently, and it is
   * the one part of the bookkeeping worth reporting: it is the difference between being able to
   * re-download this project from the completed list later and not.
   */
  archived: Promise<void> | null;
}

/**
 * Build a project's CSV, hand it to the browser, and record that it happened.
 *
 * One implementation for both export paths — the header button and the file loader's per-row export —
 * for the same reason `lib/csv.ts` is shared: the archive entry a re-download is rebuilt from has to
 * match what was originally downloaded, and two copies of this would drift the first time either was
 * tuned.
 *
 * Two things are recorded, and both matter on the dashboard. The archive entry is what lets a
 * completed project still be listed, and its CSV rebuilt, after the `savedFiles` record is gone; the
 * stamp on the record is what distinguishes a project that was exported and kept from one nobody has
 * finished — and it is what the file loader now shows on each row.
 *
 * Neither is awaited and neither blocks the export: by the time they run the CSV is already on its way
 * to disk, and refusing to complete an export that has visibly happened because a bookkeeping write
 * failed would be worse than a missing archive row.
 */
export function exportProject(input: ProjectExportInput): ProjectExportResult {
  const { data, editedAnswers, ratings, contextUrls, sourceFilename, docId } = input;
  const downloadName = csvFilenameFor(sourceFilename);

  const csv = buildCsv(data, { editedAnswers, ratings, contextUrls });
  if (!downloadCsv(csv, downloadName)) {
    return { downloaded: false, downloadName, archived: null };
  }

  if (!docId) return { downloaded: true, downloadName, archived: null };

  const exportedBy = auth.currentUser?.displayName ?? auth.currentUser?.email ?? 'Unknown';
  const exportedByEmail = auth.currentUser?.email ?? '';

  const archived = archiveProject({
    // The *source* name, because that is what the completed list feeds back through `csvFilenameFor`
    // to rebuild this CSV. Storing the download name instead put a name that had already been through
    // it into it a second time, so a re-download came out as `results-export.csv-export.csv`. The
    // fallback mirrors `csvFilenameFor`'s own `results` stem, so a project with no source name still
    // re-downloads under the name it was exported as.
    filename: sourceFilename ?? 'results.json',
    exportedBy,
    exportedByEmail,
    data,
    editedAnswers,
    sourceSessionId: docId,
  }).then(() => undefined);

  void markExported(docId, exportedBy, exportedByEmail, Date.now()).catch(() => {});

  return { downloaded: true, downloadName, archived };
}
