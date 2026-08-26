"use client";

import QuestionCard from "./QuestionCard";
import TeamMemberSelect from "./TeamMemberSelect";
import { questionState } from "@/lib/utils";
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
  /** Ids a human has approved. Missing id means the question is still ready for approval. */
  approvals: Record<string, true>;
  onSetApproved: (id: string, approved: boolean) => void;
  /** Ids of the cards that are expanded. Missing id means collapsed. */
  expandedIds: Record<string, true>;
  onSetExpanded: (id: string, open: boolean) => void;
  /**
   * Whether this section's questions are shown. Independent of `expandedIds`: hiding the list
   * leaves each card's own expansion alone, so re-opening the section restores it as it was.
   */
  open: boolean;
  onSetOpen: (sectionKey: string, open: boolean) => void;
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
  approvals,
  onSetApproved,
  expandedIds,
  onSetExpanded,
  open,
  onSetOpen,
  assignee,
  onSaveAssignee,
  onClearAssignee,
  reviewer,
  onSaveReviewer,
  onClearReviewer,
  teamMembers,
}: Props) {
  // The section's own tallies. Ready and Approved are counted separately: a section is only finished
  // when its Ready count reaches zero, which the old single "Answered" figure could not show.
  const counts = { unanswered: 0, ready: 0, approved: 0 };
  for (const item of items) {
    counts[questionState(item.answer, editedAnswers[item.id], approvals[item.id] === true)]++;
  }
  const editedCount = items.filter((i) => editedAnswers[i.id] !== undefined).length;

  // Section keys can carry spaces and punctuation (explicit labels are used verbatim), so they are
  // squeezed into something usable as an id for aria-controls.
  const panelId = `section-cards-${section.key.replace(/[^\w-]+/g, "-")}`;

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
        {counts.ready > 0 && (
          <span className="section-header__block section-header__block--information">
            {counts.ready} Ready
          </span>
        )}
        {counts.approved > 0 && (
          <span className="section-header__block section-header__block--positive">
            {counts.approved} Approved
          </span>
        )}
        {counts.unanswered > 0 && (
          <span className="section-header__block section-header__block--negative">
            {counts.unanswered} Unanswered
          </span>
        )}
        {editedCount > 0 && (
          <span className="section-header__block section-header__block--caution">
            {editedCount} Edited
          </span>
        )}
        <div className="section-header__rule" />

        {/* Whole-section toggle. Last in the row, past the rule, so it sits at the right edge. */}
        <button
          onClick={() => onSetOpen(section.key, !open)}
          aria-expanded={open}
          aria-controls={panelId}
          title={open ? "Collapse section" : "Expand section"}
          className="section-header__toggle"
        >
          <i className={open ? "p-icon--chevron-up" : "p-icon--chevron-down"}></i>
          <span className="u-off-screen">
            {open ? `Collapse ${section.label}` : `Expand ${section.label}`}
          </span>
        </button>
      </div>

      {/* Question cards. Hidden rather than unmounted when the section is closed: a card mid-edit
          would otherwise lose its unsaved draft to a stray click on the section toggle. */}
      <div
        id={panelId}
        className={`section-cards ${open ? "" : "is-collapsed"}`}
      >
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
            approved={approvals[item.id] === true}
            onSetApproved={onSetApproved}
            open={expandedIds[item.id] === true}
            onSetOpen={onSetExpanded}
          />
        ))}
      </div>
    </div>
  );
}
