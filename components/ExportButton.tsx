"use client";

import { useState } from "react";
import { removeSavedFile } from "@/lib/savedFiles";
import type { ParsedQAFile } from "@/lib/types";

interface Props {
  data: ParsedQAFile;
  editedAnswers: Record<string, string>;
  ratings: Record<string, number>;
  contextUrls: Record<string, string>;
  /** Answered but not signed off. The export reads as a finished document, so these get a warning. */
  readyCount: number;
  /** No answer text at all. Also unapproved, and rather more so. */
  unansweredCount: number;
  sourceFilename: string | null;
  /** Saved-file id. Null when the doc did not come from the shared bank, so there is nothing to remove. */
  docId: string | null;
  onError: (title: string, message: string) => void;
  /** Called after the doc is removed from the shared bank, so the view can close it. */
  onDocRemoved: (docId: string) => void;
}

/** Escape a value for CSV: wrap in quotes if it contains commas, quotes, or newlines. */
function csvCell(value: string | number | undefined): string {
  const str = value === undefined || value === null ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(
  data: ParsedQAFile,
  editedAnswers: Record<string, string>,
  ratings: Record<string, number>,
  contextUrls: Record<string, string>
): string {
  const header = ["Question", "Original Answer", "Edited Answer", "Context URL", "Rating"];
  const rows = data.items.map((item) => [
    csvCell(item.question),
    csvCell(item.answer),
    csvCell(editedAnswers[item.id] ?? ""),
    csvCell(contextUrls[item.id] ?? ""),
    csvCell(ratings[item.id]),
  ]);
  return [header.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
}

/**
 * "closed" is the resting state; the rest are the steps of the export flow.
 *
 * "warn-unapproved" sits in front of "choose" and only appears when something is still unapproved.
 * The CSV carries no approval column — it is written on the assumption that what it contains has
 * been signed off — so exporting early is the one mistake the format itself cannot record.
 */
type Stage = "closed" | "warn-unapproved" | "choose" | "confirm-remove";

export default function ExportButton({
  data,
  editedAnswers,
  ratings,
  contextUrls,
  readyCount,
  unansweredCount,
  sourceFilename,
  docId,
  onError,
  onDocRemoved,
}: Props) {
  const [exported, setExported] = useState(false);
  const [stage, setStage] = useState<Stage>("closed");
  const [removing, setRemoving] = useState(false);

  const editCount = Object.keys(editedAnswers).length;
  const ratingCount = Object.keys(ratings).length;
  const unapprovedCount = readyCount + unansweredCount;

  const downloadName = `${
    sourceFilename ? sourceFilename.replace(/\.json$/i, "") : "results"
  }-export.csv`;

  /**
   * Build the CSV and hand it to the browser.
   *
   * Returns whether the download was successfully *initiated*. A browser gives no callback for a
   * download completing, so this cannot mean the file reached the disk: it means the CSV was built
   * with content, the blob was created, and the click was dispatched without throwing. That is the
   * strongest signal available in a page, and it is what gates the removal step.
   */
  function runExport(): boolean {
    try {
      const csv = buildCsv(data, editedAnswers, ratings, contextUrls);
      if (!csv) return false;

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      if (blob.size === 0) return false;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = downloadName;
      // Some browsers only act on a click if the anchor is in the document.
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke on a later tick. Revoking in the same tick as the click can cancel the download
      // before it starts, which would make a failed export look like a successful one.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      return true;
    } catch {
      return false;
    }
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
        onClick={() => setStage(unapprovedCount > 0 ? "warn-unapproved" : "choose")}
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

      {stage === "warn-unapproved" && (
        <div
          className="p-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-unapproved-title"
        >
          <div className="p-modal__dialog">
            <header className="p-modal__header">
              <h2 className="p-modal__title" id="export-unapproved-title">
                {unapprovedCount} question{unapprovedCount !== 1 ? "s" : ""} not approved yet
              </h2>
            </header>
            <div className="remove-member-modal__body">
              <i className="p-icon--warning p-icon--large"></i>
              <div>
                <p className="u-no-margin--bottom">
                  <strong>
                    {data.items.length - unapprovedCount} of {data.items.length} approved
                  </strong>
                </p>
                <p className="u-text--muted p-text--small u-no-margin--bottom">
                  {[
                    readyCount > 0 && `${readyCount} awaiting approval`,
                    unansweredCount > 0 && `${unansweredCount} unanswered`,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </p>
              </div>
            </div>
            <p>
              The CSV does not record approval, so anyone reading it will take every row as signed
              off. Approve the outstanding questions first, or export anyway if you know that is what
              you want.
            </p>
            <footer className="p-modal__footer">
              <button
                className="p-button--base u-no-margin--bottom"
                onClick={() => setStage("closed")}
              >
                Cancel
              </button>
              <button
                className="p-button--negative u-no-margin--bottom"
                onClick={() => setStage("choose")}
              >
                Export anyway
              </button>
            </footer>
          </div>
        </div>
      )}

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
