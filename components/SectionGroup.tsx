"use client";

import React from "react";
import QuestionCard from "./QuestionCard";
import { isUnanswered } from "@/lib/utils";
import type { QAItem } from "@/lib/types";

interface Props {
  section: string;
  items: QAItem[];
  searchTerm?: string;
  editedAnswers: Record<string, string>;
  onSaveEdit: (id: string, answer: string) => void;
  onClearEdit: (id: string) => void;
  ratings: Record<string, number>;
  onSaveRating: (id: string, rating: number) => void;
  onClearRating: (id: string) => void;
  contextUrls: Record<string, string>;
  onSaveContextUrl: (id: string, url: string) => void;
  onClearContextUrl: (id: string) => void;
}

export default function SectionGroup({
  section,
  items,
  searchTerm = "",
  editedAnswers,
  onSaveEdit,
  onClearEdit,
  ratings,
  onSaveRating,
  onClearRating,
  contextUrls,
  onSaveContextUrl,
  onClearContextUrl,
}: Props) {
  const unansweredCount = items.filter(
    (i) => isUnanswered(i.answer) && !editedAnswers[i.id]
  ).length;
  const editedCount = items.filter((i) => editedAnswers[i.id] !== undefined).length;

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-gray-900 dark:text-white">
            Section {section}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
            {items.length} {items.length === 1 ? "question" : "questions"}
          </span>
          {unansweredCount > 0 && (
            <span className="text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-2 py-0.5 rounded-full">
              {unansweredCount} unanswered
            </span>
          )}
          {editedCount > 0 && (
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 rounded-full">
              {editedCount} edited
            </span>
          )}
        </div>
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
      </div>

      {/* Question cards */}
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <QuestionCard
            key={item.id}
            item={item}
            searchTerm={searchTerm}
            editedAnswer={editedAnswers[item.id]}
            onSaveEdit={onSaveEdit}
            onClearEdit={onClearEdit}
            rating={ratings[item.id]}
            onSaveRating={onSaveRating}
            onClearRating={onClearRating}
            contextUrl={contextUrls[item.id]}
            onSaveContextUrl={onSaveContextUrl}
            onClearContextUrl={onClearContextUrl}
          />
        ))}
      </div>
    </div>
  );
}
