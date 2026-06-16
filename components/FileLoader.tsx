"use client";

import React, { useRef, useState } from "react";
import { parseQAFile } from "@/lib/utils";
import type { ParsedQAFile } from "@/lib/types";

interface Props {
  onLoad: (data: ParsedQAFile, filename: string) => void;
}

export default function FileLoader({ onLoad }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

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
        onLoad(parsed, file.name);
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

  return (
    <div className="file-loader">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="p-button--base is-dense u-no-margin--bottom file-loader__button"
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
      {error && (
        <p className="file-loader__error p-text--small">
          <i className="p-icon--error"></i> {error}
        </p>
      )}
    </div>
  );
}
