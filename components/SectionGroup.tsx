"use client";

import QuestionCard from "./QuestionCard";
import TeamMemberAvatar from "./TeamMemberAvatar";
import { isUnanswered } from "@/lib/utils";
import type { QAItem, TeamMember } from "@/lib/types";

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
  assignees: Record<string, string>;
  onSaveAssignee: (id: string, memberId: string) => void;
  onClearAssignee: (id: string) => void;
  reviewers: Record<string, string>;
  onSaveReviewer: (id: string, memberId: string) => void;
  onClearReviewer: (id: string) => void;
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
  assignees,
  onSaveAssignee,
  onClearAssignee,
  reviewers,
  onSaveReviewer,
  onClearReviewer,
  teamMembers,
}: Props) {
  const unansweredCount = items.filter(
    (i) => isUnanswered(i.answer) && !editedAnswers[i.id]
  ).length;
  const answeredCount = items.length - unansweredCount;
  const editedCount = items.filter((i) => editedAnswers[i.id] !== undefined).length;

  const assigneeId = items.length > 0 ? assignees[items[0].id] : undefined;
  const assigneeMember = teamMembers.find((m) => m.id === assigneeId);

  const reviewerId = items.length > 0 ? reviewers[items[0].id] : undefined;
  const reviewerMember = teamMembers.find((m) => m.id === reviewerId);

  return (
    <div>
      {/* Section header */}
      <div className="section-header">
        <span className="p-heading--5 u-no-margin--bottom">
          Section {section}
        </span>
        <span className="section-header__block">
          Assignee:
          <span className="section-header__assignment">
            {assigneeMember ? (
              <>
                <TeamMemberAvatar member={assigneeMember} size="small" />
                {assigneeMember.name}
              </>
            ) : (
              "Unassigned"
            )}
          </span>
        </span>
        <span className="section-header__block">
          Reviewer:
          <span className="section-header__assignment">
            {reviewerMember ? (
              <>
                <TeamMemberAvatar member={reviewerMember} size="small" />
                {reviewerMember.name}
              </>
            ) : (
              "Unassigned"
            )}
          </span>
        </span>
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
            assignee={assignees[item.id]}
            onSaveAssignee={onSaveAssignee}
            onClearAssignee={onClearAssignee}
            reviewer={reviewers[item.id]}
            onSaveReviewer={onSaveReviewer}
            onClearReviewer={onClearReviewer}
            teamMembers={teamMembers}
          />
        ))}
      </div>
    </div>
  );
}
