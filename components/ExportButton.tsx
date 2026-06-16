"use client";

import { useState } from "react";
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
  );
}
