"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import Header from "@/components/Header";
import FilterBar from "@/components/FilterBar";
import SectionGroup from "@/components/SectionGroup";
import ExportButton from "@/components/ExportButton";
import { groupBySection, getSections, isUnanswered } from "@/lib/utils";
import type { ParsedQAFile, Filters, QAItem } from "@/lib/types";

const DEFAULT_FILTERS: Filters = { status: "all", section: "", search: "" };

export default function Home() {
  const [data, setData] = useState<ParsedQAFile | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [darkMode, setDarkMode] = useState(false);
  // Map of item id → edited answer text
  const [editedAnswers, setEditedAnswers] = useState<Record<string, string>>({});
  // Map of item id → 1–5 rating
  const [ratings, setRatings] = useState<Record<string, number>>({});

  // Sync dark mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add("dark");
    else root.classList.remove("dark");
  }, [darkMode]);

  // Load persisted dark mode preference
  useEffect(() => {
    const stored = localStorage.getItem("darkMode");
    if (stored === "true") setDarkMode(true);
  }, []);

  function toggleDark() {
    setDarkMode((d) => {
      localStorage.setItem("darkMode", String(!d));
      return !d;
    });
  }

  const handleLoad = useCallback((loaded: ParsedQAFile, name: string) => {
    setData(loaded);
    setFilename(name);
    setFilters(DEFAULT_FILTERS);
    setEditedAnswers({});
    setRatings({});
  }, []);

  const handleSaveRating = useCallback((id: string, rating: number) => {
    setRatings((prev) => ({ ...prev, [id]: rating }));
  }, []);

  const handleClearRating = useCallback((id: string) => {
    setRatings((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const handleSaveEdit = useCallback((id: string, answer: string) => {
    setEditedAnswers((prev) => ({ ...prev, [id]: answer }));
  }, []);

  const handleClearEdit = useCallback((id: string) => {
    setEditedAnswers((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // Unanswered count: only items without a saved edit
  const unansweredCount = useMemo(
    () =>
      data
        ? data.items.filter(
            (i) => isUnanswered(i.answer) && !editedAnswers[i.id]
          ).length
        : 0,
    [data, editedAnswers]
  );

  // Get all unique sections
  const allSections = useMemo(
    () => (data ? getSections(data.items) : []),
    [data]
  );

  // Apply filters (search also checks edited answer when present)
  const filteredItems = useMemo((): QAItem[] => {
    if (!data) return [];
    const { status, section, search } = filters;
    const term = search.toLowerCase();
    return data.items.filter((item) => {
      const effectiveAnswer = editedAnswers[item.id] ?? item.answer;
      const effectivelyUnanswered =
        isUnanswered(item.answer) && !editedAnswers[item.id];
      if (status === "answered" && effectivelyUnanswered) return false;
      if (status === "unanswered" && !effectivelyUnanswered) return false;
      if (section && item.id.split(".")[0] !== section) return false;
      if (term) {
        const inQ = item.question.toLowerCase().includes(term);
        const inA = effectiveAnswer.toLowerCase().includes(term);
        if (!inQ && !inA) return false;
      }
      return true;
    });
  }, [data, filters, editedAnswers]);

  // Group filtered items by section
  const grouped = useMemo(() => groupBySection(filteredItems), [filteredItems]);

  const editCount = Object.keys(editedAnswers).length;

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        data={data}
        filename={filename}
        unansweredCount={unansweredCount}
        totalCount={data?.items.length ?? 0}
        onLoad={handleLoad}
        darkMode={darkMode}
        onToggleDark={toggleDark}
      />

      {data ? (
        <>
          <FilterBar
            filters={filters}
            sections={allSections}
            onChange={setFilters}
            resultCount={filteredItems.length}
            totalCount={data.items.length}
          />

          <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6">
            {grouped.length === 0 ? (
              <div className="text-center py-20 text-gray-500 dark:text-gray-400">
                <svg className="w-12 h-12 mx-auto mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-lg font-medium">No questions match your filters</p>
                <button
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                  className="mt-3 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Clear all filters
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-8">
                {grouped.map(({ section, items }) => (
                  <SectionGroup
                    key={section}
                    section={section}
                    items={items}
                    searchTerm={filters.search}
                    editedAnswers={editedAnswers}
                    onSaveEdit={handleSaveEdit}
                    onClearEdit={handleClearEdit}
                    ratings={ratings}
                    onSaveRating={handleSaveRating}
                    onClearRating={handleClearRating}
                  />
                ))}
              </div>
            )}

            {/* Export section — always shown at the bottom when data is loaded */}
            <div className="mt-12 pt-8 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  Export results
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  CSV with question, original answer, edited answer, and rating columns.
                  {editCount > 0 && ` ${editCount} edited answer${editCount !== 1 ? "s" : ""} included.`}
                </p>
              </div>
              <ExportButton
                data={data}
                editedAnswers={editedAnswers}
                ratings={ratings}
                sourceFilename={filename}
              />
            </div>
          </main>
        </>
      ) : (
        /* Empty state */
        <main className="flex-1 flex flex-col items-center justify-center px-4 py-20 text-center">
          <div className="w-20 h-20 bg-blue-100 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center mb-6">
            <svg className="w-10 h-10 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            No file loaded
          </h2>
          <p className="text-gray-500 dark:text-gray-400 max-w-sm">
            Use the file loader above to open a JSON results file and start exploring Q&amp;A pairs.
          </p>
          <div className="mt-8 text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 max-w-sm text-sm text-gray-600 dark:text-gray-300">
            <p className="font-semibold text-gray-800 dark:text-gray-100 mb-2">Expected JSON format:</p>
            <pre className="text-xs font-mono text-gray-500 dark:text-gray-400 overflow-x-auto">{`{
  "generated_at": "2026-04-09T...",
  "model": "model-name",
  "results": [
    {
      "id": "1.1",
      "question": "...",
      "answer": "..."
    }
  ]
}`}</pre>
          </div>
        </main>
      )}
    </div>
  );
}
