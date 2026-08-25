"use client";

import QuestionCard from "./QuestionCard";
import TeamMemberSelect from "./TeamMemberSelect";
import { isUnanswered } from "@/lib/utils";
import type { QAItem, SectionInfo, TeamMember } from "@/lib/types";

interface Props {
  section: SectionInfo;
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
  /** This section's assignee/reviewer. Assignment is per section, not per question. */
  assignee?: string;
  onSaveAssignee: (sectionKey: string, memberId: string) => void;
  onClearAssignee: (sectionKey: string) => void;
  reviewer?: string;
  onSaveReviewer: (sectionKey: string, memberId: string) => void;
  onClearReviewer: (sectionKey: string) => void;
  teamMembers: TeamMember[];
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
  assignee,
  onSaveAssignee,
  onClearAssignee,
  reviewer,
  onSaveReviewer,
  onClearReviewer,
  teamMembers,
}: Props) {
  const unansweredCount = items.filter(
    (i) => isUnanswered(i.answer) && !editedAnswers[i.id]
  ).length;
  const answeredCount = items.length - unansweredCount;
  const editedCount = items.filter((i) => editedAnswers[i.id] !== undefined).length;

  return (
    <div>
      {/* Section header */}
      <div className="section-header">
        <span className="p-heading--5 u-no-margin--bottom">{section.label}</span>

        {/* Assignee and reviewer, one clickable box each. Both read straight off the section's
            identity, so every question in the section shows the same assignment however the list
            is filtered. */}
        <TeamMemberSelect
          label="Assignee:"
          value={assignee}
          teamMembers={teamMembers}
          onSelect={(memberId) => onSaveAssignee(section.key, memberId)}
          onClear={() => onClearAssignee(section.key)}
        />
        <TeamMemberSelect
          label="Reviewer:"
          value={reviewer}
          teamMembers={teamMembers}
          onSelect={(memberId) => onSaveReviewer(section.key, memberId)}
          onClear={() => onClearReviewer(section.key)}
        />

        <span className="section-header__block">
          {items.length} {items.length === 1 ? "Question" : "Questions"}
        </span>
        {answeredCount > 0 && (
          <span className="section-header__block section-header__block--positive">
            {answeredCount} Answered
          </span>
        )}
        {unansweredCount > 0 && (
          <span className="section-header__block section-header__block--negative">
            {unansweredCount} Unanswered
          </span>
        )}
        {editedCount > 0 && (
          <span className="section-header__block section-header__block--caution">
            {editedCount} Edited
          </span>
        )}
        <div className="section-header__rule" />
      </div>

      {/* Question cards */}
      <div className="section-cards">
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
