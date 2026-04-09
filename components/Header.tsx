"use client";

import React from "react";
import FileLoader from "./FileLoader";
import { formatDate } from "@/lib/utils";
import type { ParsedQAFile } from "@/lib/types";

interface Props {
  data: ParsedQAFile | null;
  filename: string | null;
  unansweredCount: number;
  totalCount: number;
  onLoad: (data: ParsedQAFile, filename: string) => void;
  darkMode: boolean;
  onToggleDark: () => void;
}

export default function Header({
  data,
  filename,
  unansweredCount,
  totalCount,
  onLoad,
  darkMode,
  onToggleDark,
}: Props) {
  const answeredCount = totalCount - unansweredCount;

  return (
    <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-sm sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 py-4">
        {/* Top row: title + dark mode */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">
              RAG Snap UI
            </h1>
          </div>
          <button
            onClick={onToggleDark}
            aria-label="Toggle dark mode"
            className="p-2 rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            {darkMode ? (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
              </svg>
            )}
          </button>
        </div>

        {/* File loader */}
        <FileLoader onLoad={onLoad} />

        {/* Metadata row - shown only when a file is loaded */}
        {data && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* Filename */}
            {filename && (
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md truncate max-w-[200px]">
                {filename}
              </span>
            )}
            {/* Model */}
            <span className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              {data.model}
            </span>
            {/* Date */}
            <span className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {formatDate(data.generated_at)}
            </span>

            {/* Stats badges */}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 px-2.5 py-1 rounded-full">
                {answeredCount} answered
              </span>
              {unansweredCount > 0 ? (
                <span className="text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 px-2.5 py-1 rounded-full flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  {unansweredCount} unanswered
                </span>
              ) : (
                <span className="text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-2.5 py-1 rounded-full">
                  All answered!
                </span>
              )}
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {totalCount} total
              </span>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
