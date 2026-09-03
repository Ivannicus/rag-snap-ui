import type { ParsedQAFile } from './types';

/**
 * CSV building and downloading, shared by the export flow and by the dashboard's completed list.
 *
 * Extracted from `ExportButton` so that regenerating an archived project's CSV produces byte-identical
 * output to the download it originally got. Two implementations of the same columns is how the copy
 * someone re-downloads months later stops matching the copy they filed.
 */

/** Escape a value for CSV: wrap in quotes if it contains commas, quotes, or newlines. */
function csvCell(value: string | number | undefined): string {
  const str = value === undefined || value === null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export interface CsvOverlays {
  editedAnswers: Record<string, string>;
  ratings?: Record<string, number>;
  contextUrls?: Record<string, string>;
}

export function buildCsv(data: ParsedQAFile, overlays: CsvOverlays): string {
  const { editedAnswers, ratings = {}, contextUrls = {} } = overlays;
  const header = ['Question', 'Original Answer', 'Edited Answer', 'Context URL', 'Rating'];
  const rows = data.items.map((item) => [
    csvCell(item.question),
    csvCell(item.answer),
    csvCell(editedAnswers[item.id] ?? ''),
    csvCell(contextUrls[item.id] ?? ''),
    csvCell(ratings[item.id]),
  ]);
  return [header.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
}

/** `results-export.csv` for a source filename of `results.json`. */
export function csvFilenameFor(sourceFilename: string | null): string {
  const stem = sourceFilename ? sourceFilename.replace(/\.json$/i, '') : 'results';
  return `${stem}-export.csv`;
}

/**
 * Hand a CSV to the browser as a download.
 *
 * Returns whether the download was successfully *initiated*. A browser gives no callback for a
 * download completing, so this cannot mean the file reached the disk: it means the CSV had content,
 * the blob was created, and the click was dispatched without throwing. That is the strongest signal
 * available in a page, and it is what gates the removal step of the export flow.
 */
export function downloadCsv(csv: string, downloadName: string): boolean {
  try {
    if (!csv) return false;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    if (blob.size === 0) return false;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    // Some browsers only act on a click if the anchor is in the document.
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke on a later tick. Revoking in the same tick as the click can cancel the download before
    // it starts, which would make a failed export look like a successful one.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  } catch {
    return false;
  }
}
