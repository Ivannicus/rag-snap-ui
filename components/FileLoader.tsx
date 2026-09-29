"use client";

import React, { useEffect, useRef, useState } from "react";
import { subscribeToSavedFiles, removeSavedFile, getSavedFile } from "@/lib/savedFiles";
import { getSessionOverlays } from "@/lib/session";
import { exportProject } from "@/lib/export";
import type { ParsedQAFile, SavedFileMeta } from "@/lib/types";

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
  /** `docId` is the saved-file id, which is also the id of the doc's collaboration room. */
  onLoad: (data: ParsedQAFile, filename: string, docId: string) => void;
  /** Called with the removed doc's id. The view closes it only if it is the one on screen. */
  onDocRemoved: (docId: string) => void;
  /** Called once a project exported from a row is archived, so the dashboard can re-read its lists. */
  onExported: () => void;
  /**
   * Start creating a project — the file picker, then the configuration modal, both owned by
   * `AppShell`.
   *
   * This component used to do the uploading itself: pick a file, parse it, save it, open it. Creating a
   * project now has to collect a due date and a team on the way through, and the dashboard's New
   * project button starts the identical flow, so the whole of it moved up to the shell and this is a
   * pure picker over what is already saved.
   */
  onNewProject: () => void;
}

export default function FileLoader({ onLoad, onDocRemoved, onExported, onNewProject }: Props) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null);
  const [savedFiles, setSavedFiles] = useState<SavedFileMeta[]>([]);
  const [fileToRemove, setFileToRemove] = useState<SavedFileMeta | null>(null);
  // The doc whose document is being fetched from a click on its row, so the row can say so.
  const [openingId, setOpeningId] = useState<string | null>(null);
  // Set while the confirmation's "Export and remove" is fetching the document and overlays it needs
  // to build the CSV, so the dialog can say so and refuse a second click.
  const [exportingBeforeRemove, setExportingBeforeRemove] = useState(false);

  useEffect(() => {
    return subscribeToSavedFiles(setSavedFiles);
  }, []);

  useEffect(() => {
    if (!open || fileToRemove) return;
    function handleClickOutside(e: MouseEvent) {
      // Real user clicks only. This listener runs in the capture phase at document level and cancels
      // what it decides is an outside click, which made it swallow the shell's file picker: "New
      // project" below calls `.click()` on a hidden input that lives at the shell's root, outside this
      // wrapper, so the synthetic click looked like a click elsewhere on the page and the
      // `preventDefault` here cancelled the input's activation behaviour — which *is* showing the
      // picker. Nothing happened, and only from this dropdown, because the dashboard's own New project
      // button fires with no panel open and so no listener attached.
      //
      // `isTrusted` is false for any event dispatched from script and true only for genuine user input,
      // which is exactly the distinction this wants: a programmatic click is never the user clicking
      // somewhere else.
      if (!e.isTrusted) return;
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        e.stopPropagation();
        e.preventDefault();
        setOpen(false);
      }
    }
    document.addEventListener("click", handleClickOutside, true);
    return () => document.removeEventListener("click", handleClickOutside, true);
  }, [open, fileToRemove]);

  function handleToggleOpen() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPanelPosition({ top: rect.bottom + 8, left: rect.left });
    }
    setOpen((o) => !o);
  }

  /**
   * Hand a new project off to the shell, and get out of the way.
   *
   * The panel closes immediately rather than waiting: what happens next is a file picker and then a
   * modal, both of which cover this panel, and a dropdown left open behind them is still listening for
   * the outside click that dismisses it.
   */
  function handleNewProject() {
    setError(null);
    setOpen(false);
    onNewProject();
  }

  /**
   * Open a doc from the shared list.
   *
   * The list carries metadata only, so the document is fetched here rather than read off the row — the
   * same route `handleOpenProject` takes from the dashboard. That is the point of the split: listing
   * the bank no longer transfers every document in it, and one is loaded when someone asks for one.
   *
   * The panel stays open until the fetch lands, so the row can say it is working and a failure is
   * reported somewhere the reader is still looking.
   */
  async function handleSelectSavedFile(file: SavedFileMeta) {
    setError(null);
    setOpeningId(file.id);
    try {
      const saved = await getSavedFile(file.id);
      if (!saved) {
        setError(`"${file.filename}" could not be opened. It may have just been removed.`);
        return;
      }
      onLoad(saved.data, saved.filename, saved.id);
      setOpen(false);
    } catch {
      setError(`"${file.filename}" could not be loaded. Check your connection and try again.`);
    } finally {
      setOpeningId(null);
    }
  }

  /**
   * Download this project's CSV, then remove it — the file loader's version of the header's
   * Export-and-remove, and the same sequence in the same order.
   *
   * The export runs through the shared `exportProject`, so a project taken out of the list from here
   * is archived and stamped exactly as one exported from inside the document, and re-downloads from
   * the completed list byte for byte.
   *
   * Two things have to be fetched first, because this row carries metadata only: the document, and
   * the room's overlays, which hold the edits and ratings that make the CSV worth keeping. They run
   * together — neither depends on the other.
   *
   * Nothing is removed unless the download actually started. That is the whole point of the pairing:
   * `downloadCsv` reports only that the browser was handed the file, which is the strongest signal
   * available, and it is a far better gate than removing first and hoping.
   */
  async function exportAndRemoveFile() {
    if (!fileToRemove) return;
    const target = fileToRemove;
    setError(null);
    setExportingBeforeRemove(true);
    try {
      const [saved, overlays] = await Promise.all([
        getSavedFile(target.id),
        getSessionOverlays(target.id),
      ]);
      if (!saved) {
        setFileToRemove(null);
        setError(`"${target.filename}" could not be read, so nothing was exported or removed.`);
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
        setFileToRemove(null);
        setError(
          `"${target.filename}" could not be turned into a CSV. Nothing was downloaded and nothing was removed.`
        );
        return;
      }

      // Surfaced but not awaited, like every other archive write: the CSV is already on its way to
      // disk, and this is the difference between being able to re-download it later and not.
      archived?.catch(() =>
        setError(
          `"${target.filename}" downloaded, but it could not be added to the completed list — keep the file you just saved.`
        )
      );
      onExported();

      await removeSavedFile(target.id);
      setFileToRemove(null);
      onDocRemoved(target.id);
    } catch {
      setFileToRemove(null);
      setError(
        `"${target.filename}" could not be removed. If the CSV downloaded, that copy is yours — the project is still in the list.`
      );
    } finally {
      setExportingBeforeRemove(false);
    }
  }

  async function confirmRemoveFile() {
    if (!fileToRemove) return;
    const removed = fileToRemove;
    setError(null);
    try {
      await removeSavedFile(removed.id);
    } catch {
      setFileToRemove(null);
      setError("Could not remove that file. Please try again.");
      return;
    }
    setFileToRemove(null);
    // Only after the removal succeeds, and only closes the view if this is the doc on screen.
    onDocRemoved(removed.id);
  }

  return (
    <>
    <div className="file-loader" ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggleOpen}
        aria-pressed={open}
        className={`is-dense u-no-margin--bottom file-loader__button ${open ? "p-button--brand" : "p-button--base"}`}
      >
        {/* A file icon, not an upload one: this control no longer uploads anything. It opens the list
            of projects already saved, and creating one is the button inside it. */}
        <i className="p-icon--file"></i> Projects
      </button>

      {open && panelPosition && (
        <div
          className="p-card file-loader__panel"
          style={{ top: panelPosition.top, left: panelPosition.left }}
        >
          {/* Goes through the same due-date-and-team modal the dashboard's New project button opens,
              so a project cannot be created without being configured. */}
          <button
            type="button"
            onClick={handleNewProject}
            className="p-button--positive u-no-margin--bottom is-dense file-loader__upload-button"
          >
            <i className="p-icon--plus is-light"></i> New project
          </button>

          {savedFiles.length > 0 ? (
            <ul className="p-list--divided u-no-margin--bottom file-loader__saved-list">
              {savedFiles.map((f) => (
                <li key={f.id} className="p-list__item filter-bar__member">
                  <button
                    type="button"
                    onClick={() => handleSelectSavedFile(f)}
                    disabled={openingId !== null}
                    className="file-loader__saved-file"
                  >
                    <i
                      className={
                        openingId === f.id
                          ? "p-icon--spinner u-animation--spin"
                          : "p-icon--file"
                      }
                    ></i>
                    <span className="file-loader__saved-file-info">
                      <span className="file-loader__saved-file-name">{f.filename}</span>
                      <span className="u-text--muted p-text--small u-no-margin--bottom file-loader__saved-file-uploader">
                        {openingId === f.id ? "Opening…" : `by ${f.uploadedByName}`}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => setFileToRemove(f)}
                    disabled={openingId !== null}
                    aria-label={`Remove ${f.filename}`}
                    className="p-button--negative u-no-margin--bottom is-dense file-loader__remove-button"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="u-text--muted p-text--small u-no-margin--bottom">No saved files yet.</p>
          )}
        </div>
      )}

      {error && (
        <p className="file-loader__error p-text--small">
          <i className="p-icon--error"></i> {error}
        </p>
      )}
    </div>

    {fileToRemove && (
      <div className="p-modal" role="dialog" aria-modal="true" aria-labelledby="remove-file-title">
        <div className="p-modal__dialog">
          <header className="p-modal__header">
            <h2 className="p-modal__title" id="remove-file-title">Remove saved file?</h2>
          </header>
          <div className="remove-member-modal__body">
            <i className="p-icon--file p-icon--large"></i>
            <div>
              <p className="u-no-margin--bottom"><strong>{fileToRemove.filename}</strong></p>
              <p className="u-text--muted p-text--small u-no-margin--bottom">
                Uploaded by {fileToRemove.uploadedByName} ({fileToRemove.uploadedByEmail})
              </p>
            </div>
          </div>
          {/* Stated here as well as on the row, because this is the last screen before the project
              leaves the shared list for everyone, and whether its results were ever taken off the
              system is the one fact that decides whether that is safe. */}
          {fileToRemove.exportedAt !== null ? (
            <p className="u-no-margin--bottom file-loader__export-status file-loader__export-status--done">
              <i className="p-icon--success" aria-hidden></i> Exported{" "}
              {formatExportedAt(fileToRemove.exportedAt)}
              {fileToRemove.exportedBy ? ` by ${fileToRemove.exportedBy}` : ""}, so the results are in
              the completed list and can be downloaded again from there.
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
              onClick={() => setFileToRemove(null)}
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
    )}

    </>
  );
}
