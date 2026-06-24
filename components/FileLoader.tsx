"use client";

import React, { useEffect, useRef, useState } from "react";
import { parseQAFile } from "@/lib/utils";
import { auth } from "@/lib/firebase";
import { subscribeToSavedFiles, saveFile, removeSavedFile } from "@/lib/savedFiles";
import type { ParsedQAFile, SavedFile } from "@/lib/types";

interface Props {
  onLoad: (data: ParsedQAFile, filename: string) => void;
}

export default function FileLoader({ onLoad }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null);
  const [savedFiles, setSavedFiles] = useState<SavedFile[]>([]);
  const [fileToRemove, setFileToRemove] = useState<SavedFile | null>(null);

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
      try {
        const raw = JSON.parse(e.target?.result as string);
        const parsed = parseQAFile(raw);
        saveFile({
          filename: file.name,
          data: parsed,
          uploadedByName: auth.currentUser?.displayName ?? auth.currentUser?.email ?? "Unknown",
          uploadedByEmail: auth.currentUser?.email ?? "",
        }).catch(() => setError("File loaded, but saving it for the team failed."));
        onLoad(parsed, file.name);
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to parse file.");
      }
    };
    reader.readAsText(file);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset so the same file can be re-selected
    e.target.value = "";
  }

  function handleSelectSavedFile(file: SavedFile) {
    onLoad(file.data, file.filename);
    setOpen(false);
  }

  function confirmRemoveFile() {
    if (!fileToRemove) return;
    removeSavedFile(fileToRemove.id);
    setFileToRemove(null);
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
            <ul className="p-list--divided u-no-margin--bottom">
              {savedFiles.map((f) => (
                <li key={f.id} className="p-list__item filter-bar__member">
                  <button
                    type="button"
                    onClick={() => handleSelectSavedFile(f)}
                    className="file-loader__saved-file"
                  >
                    <i className="p-icon--file"></i>
                    <span className="file-loader__saved-file-info">
                      <span className="file-loader__saved-file-name">{f.filename}</span>
                      <span className="u-text--muted p-text--small u-no-margin--bottom file-loader__saved-file-uploader">
                        by {f.uploadedByName}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => setFileToRemove(f)}
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
