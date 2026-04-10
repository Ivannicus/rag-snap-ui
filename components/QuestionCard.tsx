"use client";

import React, { useState } from "react";
import { isUnanswered } from "@/lib/utils";
import type { QAItem } from "@/lib/types";

interface Props {
  item: QAItem;
  searchTerm?: string;
  editedAnswer?: string;
  onSaveEdit: (id: string, answer: string) => void;
  onClearEdit: (id: string) => void;
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
    // Strip the leading "- " or "* " so the list-disc style doesn't double up
    const lineContent = isBullet ? line.replace(/^[-*]\s+/, "") : line;
    const boldParts = lineContent.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
      const isBoldMarker = part.startsWith("**") && part.endsWith("**");
      const inner = isBoldMarker ? part.slice(2, -2) : part;
      const highlighted = highlight(inner, searchTerm);
      return isBoldMarker
        ? <strong key={i}>{highlighted}</strong>
        : <React.Fragment key={i}>{highlighted}</React.Fragment>;
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button onClick={(e) => { e.stopPropagation(); copy(); }} title="Copy" className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
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
  );
}

export default function QuestionCard({
  item,
  searchTerm = "",
  editedAnswer,
  onSaveEdit,
  onClearEdit,
}: Props) {
  const [open, setOpen] = useState(false);
  // editing = textarea is open
  const [editing, setEditing] = useState(false);
  // draft = current textarea value
  const [draft, setDraft] = useState("");

  const unanswered = isUnanswered(item.answer);
  const hasEdit = editedAnswer !== undefined;

  function startEdit() {
    setDraft(editedAnswer ?? item.answer);
    setEditing(true);
    setOpen(true);
  }

  function saveEdit() {
    if (draft.trim()) {
      onSaveEdit(item.id, draft.trim());
    }
    setEditing(false);
  }

  function cancelEdit() {
    setEditing(false);
  }

  function revertEdit() {
    onClearEdit(item.id);
    setEditing(false);
  }

  return (
    <div
      className={`
        rounded-xl border transition-shadow
        ${unanswered && !hasEdit
          ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30"
          : hasEdit
          ? "border-amber-200 dark:border-amber-700 bg-white dark:bg-gray-800"
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
            ${unanswered && !hasEdit
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

        {/* Edited badge */}
        {hasEdit && (
          <span className="shrink-0 mt-0.5 text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 px-1.5 py-0.5 rounded">
            edited
          </span>
        )}

        {/* Unanswered warning icon — only if no edit has been applied */}
        {unanswered && !hasEdit && (
          <svg className="w-4 h-4 shrink-0 mt-0.5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
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

      {/* Collapsible answer area */}
      <div className={`overflow-hidden transition-all duration-200 ${open ? "max-h-[4000px] opacity-100" : "max-h-0 opacity-0"}`}>
        <div className="px-4 pb-4 flex flex-col gap-3">

          {/* ── Original answer ── */}
          <div>
            {hasEdit && (
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">
                Original
              </p>
            )}
            <div className={`
              text-sm leading-relaxed rounded-lg p-3 relative
              ${unanswered
                ? hasEdit
                  ? "bg-gray-100 dark:bg-gray-700/30 text-gray-400 dark:text-gray-500 line-through decoration-gray-300 dark:decoration-gray-600"
                  : "bg-red-100 dark:bg-red-900/40 text-red-900 dark:text-red-200"
                : hasEdit
                  ? "bg-gray-100 dark:bg-gray-700/30 text-gray-400 dark:text-gray-500"
                  : "bg-gray-50 dark:bg-gray-700/50 text-gray-800 dark:text-gray-200"
              }
            `}>
              {renderAnswer(item.answer, searchTerm)}
              <div className="absolute top-2 right-2 flex gap-0.5">
                <CopyButton text={item.answer} />
              </div>
            </div>
          </div>

          {/* ── Edited answer (shown when a saved edit exists) ── */}
          {hasEdit && !editing && (
            <div>
              <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide mb-1">
                Edited
              </p>
              <div className="text-sm leading-relaxed rounded-lg p-3 relative bg-amber-50 dark:bg-amber-900/20 text-gray-800 dark:text-gray-200 border border-amber-200 dark:border-amber-700">
                {renderAnswer(editedAnswer!, searchTerm)}
                <div className="absolute top-2 right-2 flex gap-0.5">
                  <CopyButton text={editedAnswer!} />
                  {/* Re-edit button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); startEdit(); }}
                    title="Edit again"
                    className="p-1 rounded text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  {/* Revert to original */}
                  <button
                    onClick={(e) => { e.stopPropagation(); revertEdit(); }}
                    title="Revert to original"
                    className="p-1 rounded text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Edit textarea (open when editing) ── */}
          {editing ? (
            <div>
              <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-1">
                {hasEdit ? "Re-editing" : "New edit"}
              </p>
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.max(4, draft.split("\n").length + 1)}
                className="w-full text-sm rounded-lg border border-blue-300 dark:border-blue-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={(e) => { e.stopPropagation(); saveEdit(); }}
                  className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                >
                  Save edit
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); cancelEdit(); }}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                {hasEdit && (
                  <button
                    onClick={(e) => { e.stopPropagation(); revertEdit(); }}
                    className="ml-auto px-3 py-1.5 text-sm font-medium rounded-lg text-red-500 hover:text-red-700 dark:hover:text-red-400 transition-colors"
                  >
                    Revert to original
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* Edit button — shown when no textarea is open and no edit exists yet */
            !hasEdit && (
              <button
                onClick={(e) => { e.stopPropagation(); startEdit(); }}
                className="self-start flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit response
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
