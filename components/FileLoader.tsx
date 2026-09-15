"use client";

import React, { useEffect, useRef, useState } from "react";
import { parseQAFile } from "@/lib/utils";
import { auth } from "@/lib/firebase";
import { subscribeToSavedFiles, saveFile, removeSavedFile, getSavedFile } from "@/lib/savedFiles";
import type { ParsedQAFile, SavedFileMeta } from "@/lib/types";

interface Props {
  /** `docId` is the saved-file id, which is also the id of the doc's collaboration room. */
  onLoad: (data: ParsedQAFile, filename: string, docId: string) => void;
  /** Called with the removed doc's id. The view closes it only if it is the one on screen. */
  onDocRemoved: (docId: string) => void;
}

export default function FileLoader({ onLoad, onDocRemoved }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null);
  const [savedFiles, setSavedFiles] = useState<SavedFileMeta[]>([]);
  const [fileToRemove, setFileToRemove] = useState<SavedFileMeta | null>(null);
  // The doc whose document is being fetched from a click on its row, so the row can say so.
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    return subscribeToSavedFiles(setSavedFiles);
  }, []);

  useEffect(() => {
    if (!open || fileToRemove) return;
    function handleClickOutside(e: MouseEvent) {
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

  function handleFile(file: File) {
    setError(null);
    if (!file.name.endsWith(".json")) {
      setError("Please select a .json file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      let parsed: ParsedQAFile;
      try {
        parsed = parseQAFile(JSON.parse(e.target?.result as string));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to parse file.");
        return;
      }

      // The doc has to be saved before it can be opened now, because its saved-file id is the id of
      // the room the view syncs through. That makes the id the one thing this must not get wrong: it
      // decides whose edits this file's questions are shown alongside.
      saveFile({
        filename: file.name,
        data: parsed,
        uploadedByName: auth.currentUser?.displayName ?? auth.currentUser?.email ?? "Unknown",
        uploadedByEmail: auth.currentUser?.email ?? "",
      })
        .then((result) => {
          if (result.ok) {
            onLoad(parsed, file.name, result.id);
            setOpen(false);
            return;
          }

          if (result.reason === "duplicate") {
            // The bank already holds this exact content, so no second copy is stored and the doc
            // that is already there is opened. What is on screen is what was just uploaded, because
            // matching content is what identified the doc in the first place.
            onLoad(parsed, file.name, result.existingId);
            setOpen(false);
            return;
          }

          // A different file already occupies this filename. Opening its id would put this file's
          // questions in a room holding someone else's document: their edits, ratings and
          // assignments would appear against these questions by position, and any edit made here
          // would be written into their doc. There is nothing correct to open, so name the clash
          // and leave the current view alone.
          setError(
            `A different file is already saved as "${file.name}". Rename this file, or remove the saved one first.`
          );
        })
        .catch(() => setError("Could not save the file for the team, so it was not opened."));
    };
    reader.readAsText(file);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset so the same file can be re-selected
    e.target.value = "";
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
        <i className="p-icon--upload"></i> Load a JSON file
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleChange}
        className="u-hide"
      />

      {open && panelPosition && (
        <div
          className="p-card file-loader__panel"
          style={{ top: panelPosition.top, left: panelPosition.left }}
        >
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="p-button--positive u-no-margin--bottom is-dense file-loader__upload-button"
          >
            <i className="p-icon--upload"></i> Upload new file
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
          <footer className="p-modal__footer">
            <button
              className="p-button--base u-no-margin--bottom"
              onClick={() => setFileToRemove(null)}
            >
              Cancel
            </button>
            <button
              className="p-button--negative u-no-margin--bottom"
              onClick={confirmRemoveFile}
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
