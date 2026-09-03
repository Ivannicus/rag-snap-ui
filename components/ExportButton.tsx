"use client";

import { useState } from "react";
import { markExported, removeSavedFile } from "@/lib/savedFiles";
import { archiveProject } from "@/lib/archive";
import { buildCsv, csvFilenameFor, downloadCsv } from "@/lib/csv";
import { auth } from "@/lib/firebase";
import type { ParsedQAFile } from "@/lib/types";

interface Props {
  data: ParsedQAFile;
  editedAnswers: Record<string, string>;
  ratings: Record<string, number>;
  contextUrls: Record<string, string>;
  sourceFilename: string | null;
  /** Saved-file id. Null when the doc did not come from the shared bank, so there is nothing to remove. */
  docId: string | null;
  onError: (title: string, message: string) => void;
  /** Called after the doc is removed from the shared bank, so the view can close it. */
  onDocRemoved: (docId: string) => void;
  /** Called once an export has been archived, so the dashboard can re-read its lists. */
  onExported: () => void;
}

/** "closed" is the resting state; the two others are the steps of the export flow. */
type Stage = "closed" | "choose" | "confirm-remove";

export default function ExportButton({
  data,
  editedAnswers,
  ratings,
  contextUrls,
  sourceFilename,
  docId,
  onError,
  onDocRemoved,
  onExported,
}: Props) {
  const [exported, setExported] = useState(false);
  const [stage, setStage] = useState<Stage>("closed");
  const [removing, setRemoving] = useState(false);

  const editCount = Object.keys(editedAnswers).length;
  const ratingCount = Object.keys(ratings).length;

  const downloadName = csvFilenameFor(sourceFilename);

  /**
   * Build the CSV, hand it to the browser, and record the export.
   *
   * Returns whether the download was successfully *initiated* — see `downloadCsv` for why that is the
   * strongest available signal. It is what gates the removal step, so the recording below happens only
   * once the download has actually started.
   *
   * Two things are recorded, and both matter on the dashboard. The archive entry is what lets a
   * completed project still be listed, and its CSV rebuilt, after the `savedFiles` record is gone; the
   * stamp on the `savedFiles` record is what distinguishes a project that was exported and kept from
   * one nobody has finished. Both run on both export paths, because "these results were taken away" is
   * the same event whether or not the project is also removed afterwards.
   *
   * Neither is awaited and neither failure blocks the export. The CSV is already on its way to the
   * reader's disk by this point, and refusing to complete an export that has visibly happened because
   * a bookkeeping write failed would be worse than a missing archive row. A failed archive write is
   * surfaced, though, because it is the difference between being able to re-download this project later
   * and not.
   */
  function runExport(): boolean {
    const csv = buildCsv(data, { editedAnswers, ratings, contextUrls });
    if (!downloadCsv(csv, downloadName)) return false;

    if (docId) {
      const exportedBy =
        auth.currentUser?.displayName ?? auth.currentUser?.email ?? "Unknown";
      const exportedByEmail = auth.currentUser?.email ?? "";

      void archiveProject({
        filename: sourceFilename ?? downloadName,
        exportedBy,
        exportedByEmail,
        data,
        editedAnswers,
        sourceSessionId: docId,
      })
        .then(() => onExported())
        .catch(() =>
          onError(
            "Export archived incompletely",
            "The CSV downloaded, but this project could not be added to the completed list. It will not be possible to re-download the results from here later, so keep the file you just saved."
          )
        );

      void markExported(docId, exportedBy, exportedByEmail, Date.now()).catch(() => {});
    }

    return true;
  }

  function flashExported() {
    setExported(true);
    setTimeout(() => setExported(false), 2500);
  }

  function reportExportFailure() {
    onError(
      "Export failed",
      "The CSV could not be created, so nothing was downloaded. Nothing has been removed, your results are untouched."
    );
  }

  function handleExportOnly() {
    if (!runExport()) {
      setStage("closed");
      reportExportFailure();
      return;
    }
    flashExported();
    setStage("closed");
  }

  function handleExportAndRemove() {
    // Export first. The doc is only ever removed after this succeeds.
    if (!runExport()) {
      setStage("closed");
      reportExportFailure();
      return;
    }
    flashExported();
    setStage("confirm-remove");
  }

  async function confirmRemove() {
    if (!docId) return;
    setRemoving(true);
    try {
      await removeSavedFile(docId);
      setStage("closed");
      // Only after the removal succeeds. A failed delete leaves the doc open.
      onDocRemoved(docId);
    } catch {
      setStage("closed");
      onError(
        "Could not remove the doc",
        "The export downloaded, but removing this doc from the shared list did not go through. It is still there, so you can try again."
      );
    } finally {
      setRemoving(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setStage("choose")}
        className={`u-no-margin--bottom ${exported ? "p-button--positive" : "p-button--brand"}`}
      >
        {exported ? (
          <>
            <i className="p-icon--success"></i> Exported!
          </>
        ) : (
          <>
            <i className="p-icon--export"></i> Export CSV
            {(editCount > 0 || ratingCount > 0) && (
              <span className="export-button__badge">
                {[
                  editCount > 0 && `${editCount} edit${editCount !== 1 ? "s" : ""}`,
                  ratingCount > 0 && `${ratingCount} rating${ratingCount !== 1 ? "s" : ""}`,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            )}
          </>
        )}
      </button>

      {stage === "choose" && (
        <div className="p-modal" role="dialog" aria-modal="true" aria-labelledby="export-doc-title">
          <div className="p-modal__dialog">
            <header className="p-modal__header">
              <h2 className="p-modal__title" id="export-doc-title">Export results?</h2>
            </header>
            <div className="remove-member-modal__body">
              <i className="p-icon--export p-icon--large"></i>
              <div>
                <p className="u-no-margin--bottom"><strong>{downloadName}</strong></p>
                <p className="u-text--muted p-text--small u-no-margin--bottom">
                  {data.items.length} question{data.items.length !== 1 ? "s" : ""}
                  {editCount > 0 && `, ${editCount} edited`}
                  {ratingCount > 0 && `, ${ratingCount} rated`}
                </p>
              </div>
            </div>
            <p className="u-text--muted p-text--small">
              {docId
                ? "Export and remove downloads the CSV and then takes this doc out of the shared list, so the team stops seeing docs nobody works on anymore. You will be asked to confirm before anything is removed."
                : "This doc is not in the shared list, so there is nothing to remove."}
            </p>
            <footer className="p-modal__footer">
              <button
                className="p-button--base u-no-margin--bottom"
                onClick={() => setStage("closed")}
              >
                Cancel
              </button>
              {docId && (
                <button
                  className="p-button--negative u-no-margin--bottom"
                  onClick={handleExportAndRemove}
                >
                  Export and remove
                </button>
              )}
              <button
                className="p-button--positive u-no-margin--bottom"
                onClick={handleExportOnly}
              >
                Export
              </button>
            </footer>
          </div>
        </div>
      )}

      {stage === "confirm-remove" && (
        <div
          className="p-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-remove-doc-title"
        >
          <div className="p-modal__dialog">
            <header className="p-modal__header">
              <h2 className="p-modal__title" id="export-remove-doc-title">
                Remove this doc from the shared list?
              </h2>
            </header>
            <div className="remove-member-modal__body">
              <i className="p-icon--file p-icon--large"></i>
              <div>
                <p className="u-no-margin--bottom"><strong>{sourceFilename ?? "This doc"}</strong></p>
                <p className="u-text--muted p-text--small u-no-margin--bottom">
                  Exported as {downloadName}
                </p>
              </div>
            </div>
            <p>
              The CSV has downloaded, so that is your copy. Removing takes the doc out of the file
              loader for everyone, and it cannot be undone.
            </p>
            <footer className="p-modal__footer">
              <button
                className="p-button--base u-no-margin--bottom"
                onClick={() => setStage("closed")}
                disabled={removing}
              >
                Cancel
              </button>
              <button
                className="p-button--negative u-no-margin--bottom"
                onClick={confirmRemove}
                disabled={removing}
              >
                {removing ? "Removing…" : "Remove"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
