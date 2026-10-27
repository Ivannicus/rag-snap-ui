"use client";

import { useState } from "react";
import { removeSavedFile, getSavedFile } from "@/lib/savedFiles";
import { getSessionOverlays } from "@/lib/session";
import { exportProject } from "@/lib/export";
import type { SavedFileMeta } from "@/lib/types";

/** `3 Sep 2026, 14:20` — enough to tell two exports of the same project apart. */
function formatExportedAt(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Props {
  file: SavedFileMeta;
  onClose: () => void;
  /** Called with the removed project's id, once the removal has landed. */
  onDocRemoved: (docId: string) => void;
  /** Called once a project exported from here is archived, so the dashboard can re-read its lists. */
  onExported: () => void;
  onError: (message: string) => void;
}

/**
 * Confirm removing a project from the shared list, with the option to export it first.
 *
 * Lifted out of `FileLoader` unchanged so the Admin tab's project list runs exactly the same
 * confirmation, warning and Export-and-remove sequence. Removing a project is admin-only: callers gate
 * the button that opens this, and the rules refuse the write for anybody else.
 */
export default function RemoveProjectDialog({
  file,
  onClose,
  onDocRemoved,
  onExported,
  onError,
}: Props) {
  // Set while "Export and remove" is fetching the document and overlays it needs to build the CSV, so
  // the dialog can say so and refuse a second click.
  const [exportingBeforeRemove, setExportingBeforeRemove] = useState(false);

  /**
   * Download this project's CSV, then remove it — the same sequence, in the same order, as the
   * header's Export-and-remove.
   *
   * The export runs through the shared `exportProject`, so a project taken out of the list from here
   * is archived and stamped exactly as one exported from inside the document, and re-downloads from
   * the completed list byte for byte.
   *
   * Two things have to be fetched first, because the row carries metadata only: the document, and
   * the room's overlays, which hold the edits and ratings that make the CSV worth keeping. They run
   * together — neither depends on the other.
   *
   * Nothing is removed unless the download actually started. That is the whole point of the pairing:
   * `downloadCsv` reports only that the browser was handed the file, which is the strongest signal
   * available, and it is a far better gate than removing first and hoping.
   */
  async function exportAndRemoveFile() {
    const target = file;
    setExportingBeforeRemove(true);
    try {
      const [saved, overlays] = await Promise.all([
        getSavedFile(target.id),
        getSessionOverlays(target.id),
      ]);
      if (!saved) {
        onClose();
        onError(`"${target.filename}" could not be read, so nothing was exported or removed.`);
        return;
      }

      const { downloaded, archived } = exportProject({
        data: saved.data,
        editedAnswers: overlays.editedAnswers,
        ratings: overlays.ratings,
        contextUrls: overlays.contextUrls,
        sourceFilename: saved.filename,
        docId: saved.id,
      });

      if (!downloaded) {
        onClose();
        onError(
          `"${target.filename}" could not be turned into a CSV. Nothing was downloaded and nothing was removed.`
        );
        return;
      }

      // Surfaced but not awaited, like every other archive write: the CSV is already on its way to
      // disk, and this is the difference between being able to re-download it later and not.
      archived?.catch(() =>
        onError(
          `"${target.filename}" downloaded, but it could not be added to the completed list — keep the file you just saved.`
        )
      );
      onExported();

      await removeSavedFile(target.id);
      onClose();
      onDocRemoved(target.id);
    } catch {
      onClose();
      onError(
        `"${target.filename}" could not be removed. If the CSV downloaded, that copy is yours — the project is still in the list.`
      );
    } finally {
      setExportingBeforeRemove(false);
    }
  }

  async function confirmRemoveFile() {
    try {
      await removeSavedFile(file.id);
    } catch {
      onClose();
      onError(`"${file.filename}" could not be removed. Only admins can remove projects.`);
      return;
    }
    onClose();
    // Only after the removal succeeds, and only closes the view if this is the doc on screen.
    onDocRemoved(file.id);
  }

  return (
    <div className="p-modal" role="dialog" aria-modal="true" aria-labelledby="remove-file-title">
      <div className="p-modal__dialog">
        <header className="p-modal__header">
          <h2 className="p-modal__title" id="remove-file-title">Remove saved file?</h2>
        </header>
        <div className="remove-member-modal__body">
          <i className="p-icon--file p-icon--large"></i>
          <div>
            <p className="u-no-margin--bottom"><strong>{file.filename}</strong></p>
            <p className="u-text--muted p-text--small u-no-margin--bottom">
              Uploaded by {file.uploadedByName} ({file.uploadedByEmail})
            </p>
          </div>
        </div>
        {/* Stated here as well as on the row, because this is the last screen before the project
            leaves the shared list for everyone, and whether its results were ever taken off the
            system is the one fact that decides whether that is safe. */}
        {file.exportedAt !== null ? (
          <p className="u-no-margin--bottom file-loader__export-status file-loader__export-status--done">
            <i className="p-icon--success" aria-hidden></i> Exported{" "}
            {formatExportedAt(file.exportedAt)}
            {file.exportedBy ? ` by ${file.exportedBy}` : ""}, so the results are in the completed
            list and can be downloaded again from there.
          </p>
        ) : (
          <p className="u-no-margin--bottom file-loader__export-status file-loader__export-status--none">
            <i className="p-icon--warning" aria-hidden></i> Never exported. Removing it discards the
            answers, edits and ratings with no CSV anywhere — export it first if you want a copy.
          </p>
        )}
        <footer className="p-modal__footer">
          <button
            className="p-button--base u-no-margin--bottom"
            onClick={onClose}
            disabled={exportingBeforeRemove}
          >
            Cancel
          </button>
          {/* The way out of removing a project whose results nobody has saved: take the CSV first,
              in one step, rather than cancelling, opening the project and exporting it from there.
              Same sequence as the header's Export-and-remove, and the export has to succeed before
              anything is removed. */}
          <button
            className="p-button--positive u-no-margin--bottom"
            onClick={exportAndRemoveFile}
            disabled={exportingBeforeRemove}
          >
            {exportingBeforeRemove ? (
              <>
                <i className="p-icon--spinner u-animation--spin is-light" aria-hidden></i>{" "}
                Exporting…
              </>
            ) : (
              <>
                <i className="p-icon--export is-light" aria-hidden></i> Export and remove
              </>
            )}
          </button>
          <button
            className="p-button--negative u-no-margin--bottom"
            onClick={confirmRemoveFile}
            disabled={exportingBeforeRemove}
          >
            Remove
          </button>
        </footer>
      </div>
    </div>
  );
}
