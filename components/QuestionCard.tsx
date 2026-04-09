"use client";

import React, { useState } from "react";
import { isUnanswered } from "@/lib/utils";
import type { QAItem } from "@/lib/types";

interface Props {
  item: QAItem;
  searchTerm?: string;
}

/** Highlight search term occurrences in text */
function highlight(text: string, term: string): React.ReactNode {
  if (!term.trim()) return text;
  const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="bg-yellow-200 dark:bg-yellow-700 rounded px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

/** Render markdown-ish answer with optional search highlighting: bold, bullets, line breaks */
function renderAnswer(text: string, searchTerm: string): React.ReactNode {
  const lines = text.split("\n");
  return lines.map((line, idx) => {
    const isBullet = /^[-*]\s/.test(line);
    // Split on **bold** markers, then apply search highlighting to each part
    const boldParts = line.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
      const isBoldMarker = part.startsWith("**") && part.endsWith("**");
      const inner = isBoldMarker ? part.slice(2, -2) : part;
      const highlighted = highlight(inner, searchTerm);
      return isBoldMarker ? <strong key={i}>{highlighted}</strong> : <React.Fragment key={i}>{highlighted}</React.Fragment>;
    });
    return (
      <React.Fragment key={idx}>
        {isBullet ? (
          <li className="ml-4 list-disc">{boldParts}</li>
        ) : (
          <span>{boldParts}</span>
        )}
        {idx < lines.length - 1 && !isBullet && <br />}
      </React.Fragment>
    );
  });
}

export default function QuestionCard({ item, searchTerm = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const unanswered = isUnanswered(item.answer);

  function copyAnswer() {
    navigator.clipboard.writeText(item.answer).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div
      className={`
        rounded-xl border transition-shadow
        ${unanswered
          ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30"
          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
        }
      `}
    >
      {/* Question row — clickable to expand */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left flex items-start gap-3 px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {/* ID badge */}
        <span
          className={`
            mt-0.5 shrink-0 text-xs font-mono font-bold px-1.5 py-0.5 rounded
            ${unanswered
              ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
              : "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
            }
          `}
        >
          {item.id}
        </span>

        {/* Question text */}
        <span className="flex-1 text-sm text-gray-900 dark:text-gray-100 leading-snug">
          {highlight(item.question, searchTerm)}
        </span>

        {/* Unanswered warning icon */}
        {unanswered && (
          <svg
            className="w-4 h-4 shrink-0 mt-0.5 text-red-500"
            fill="currentColor" viewBox="0 0 20 20"
          >
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        )}

        {/* Chevron */}
        <svg
          className={`w-4 h-4 shrink-0 mt-0.5 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Collapsible answer */}
      <div
        className={`overflow-hidden transition-all duration-200 ${open ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"}`}
      >
        <div className="px-4 pb-4">
          <div className={`
            text-sm leading-relaxed rounded-lg p-3 relative
            ${unanswered
              ? "bg-red-100 dark:bg-red-900/40 text-red-900 dark:text-red-200"
              : "bg-gray-50 dark:bg-gray-700/50 text-gray-800 dark:text-gray-200"
            }
          `}>
            {renderAnswer(item.answer, searchTerm)}

            {/* Copy button */}
            <button
              onClick={(e) => { e.stopPropagation(); copyAnswer(); }}
              title="Copy answer"
              className="absolute top-2 right-2 p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              {copied ? (
                <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
