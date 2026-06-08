"use client";

import React, { useState } from "react";
import type { ParsedQAFile } from "@/lib/types";

interface Props {
  data: ParsedQAFile;
  editedAnswers: Record<string, string>;
  ratings: Record<string, number>;
  contextUrls: Record<string, string>;
  sourceFilename: string | null;
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

export default function ExportButton({ data, editedAnswers, ratings, contextUrls, sourceFilename }: Props) {
  const [exported, setExported] = useState(false);

  const editCount = Object.keys(editedAnswers).length;
  const ratingCount = Object.keys(ratings).length;

  function handleExport() {
    const csv = buildCsv(data, editedAnswers, ratings, contextUrls);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;

    const base = sourceFilename
      ? sourceFilename.replace(/\.json$/i, "")
      : "results";
    a.download = `${base}-export.csv`;

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
          Export CSV
          {(editCount > 0 || ratingCount > 0) && (
            <span className="bg-white/20 text-xs px-1.5 py-0.5 rounded-full">
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
  );
}
