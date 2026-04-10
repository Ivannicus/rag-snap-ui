"use client";

import React, { useState } from "react";
import type { ParsedQAFile } from "@/lib/types";

interface Props {
  data: ParsedQAFile;
  editedAnswers: Record<string, string>;
  sourceFilename: string | null;
}

export default function ExportButton({ data, editedAnswers, sourceFilename }: Props) {
  const [exported, setExported] = useState(false);

  const editCount = Object.keys(editedAnswers).length;

  function handleExport() {
    const items = data.items.map((item) => ({
      id: item.id,
      question: item.question,
      answer: editedAnswers[item.id] ?? item.answer,
    }));

    const payload = {
      generated_at: data.generated_at,
      model: data.model,
      exported_at: new Date().toISOString(),
      edits_applied: editCount,
      results: items,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;

    // Derive output filename from source: foo.json → foo-edited.json
    const base = sourceFilename
      ? sourceFilename.replace(/\.json$/i, "")
      : "results";
    a.download = `${base}-edited.json`;

    a.click();
    URL.revokeObjectURL(url);

    setExported(true);
    setTimeout(() => setExported(false), 2500);
  }

  return (
    <button
      onClick={handleExport}
      className={`
        inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm
        transition-all shadow-sm
        ${exported
          ? "bg-green-500 text-white"
          : "bg-blue-600 hover:bg-blue-700 active:scale-95 text-white"
        }
      `}
    >
      {exported ? (
        <>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Exported!
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export JSON
          {editCount > 0 && (
            <span className="bg-white/20 text-xs px-1.5 py-0.5 rounded-full">
              {editCount} edit{editCount !== 1 ? "s" : ""}
            </span>
          )}
        </>
      )}
    </button>
  );
}
