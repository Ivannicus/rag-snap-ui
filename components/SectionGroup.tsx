"use client";

import QuestionCard from "./QuestionCard";
import TeamMemberSelect from "./TeamMemberSelect";
import { isUnanswered } from "@/lib/utils";
import type { ItemStatus, QAItem, TeamMember } from "@/lib/types";

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
  /** Read-only now: passed down for the badge on cards that already have a URL. */
  contextUrls: Record<string, string>;
  itemStatus: Record<string, ItemStatus>;
  onApprove: (id: string) => void;
  onUnapprove: (id: string) => void;
  /** TeamMember.id owning this whole section, from `sectionAssignees`. */
  sectionAssignee?: string;
  onSaveSectionAssignee: (sectionKey: string, memberId: string) => void;
  onClearSectionAssignee: (sectionKey: string) => void;
  /** TeamMember.id reviewing this whole section, from `sectionReviewers`. */
  sectionReviewer?: string;
  onSaveSectionReviewer: (sectionKey: string, memberId: string) => void;
  onClearSectionReviewer: (sectionKey: string) => void;
  /** The signed-in user's TeamMember.id, or undefined if they are not in the bank. */
  myMemberId?: string;
  /**
   * The whole team bank. Needed for turning any id into a name — including ids the pickers below will
   * not offer — so it is *not* the list those pickers show. See `assignableMembers`.
   */
  teamMembers: TeamMember[];
  /**
   * Who this project's sections may be handed to: the project's owners, from `projectAssignees`.
   *
   * Empty when nobody owns the project, and the pickers then offer nobody: owners come first, on the
   * Overview dashboard. Kept separate from `teamMembers` because `approveDisabledReason` below has to
   * name the current reviewer even when that person is no longer an owner.
   */
  assignableMembers: TeamMember[];
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
  itemStatus,
  onApprove,
  onUnapprove,
  sectionAssignee,
  onSaveSectionAssignee,
  onClearSectionAssignee,
  sectionReviewer,
  onSaveSectionReviewer,
  onClearSectionReviewer,
  myMemberId,
  teamMembers,
  assignableMembers,
}: Props) {
  // The same three disjoint buckets the dashboard counts, over this section's items. Approval wins
  // over the original answer, so an approved item is never also counted as unanswered.
  const approvedCount = items.filter((i) => itemStatus[i.id] === "approved").length;
  const unansweredCount = items.filter(
    (i) => itemStatus[i.id] !== "approved" && isUnanswered(i.answer) && !editedAnswers[i.id]
  ).length;
  const readyCount = items.length - approvedCount - unansweredCount;
  const editedCount = items.filter((i) => editedAnswers[i.id] !== undefined).length;

  /**
   * Why the signed-in user may not approve in this section, or undefined when they may.
   *
   * Decided here rather than in `QuestionCard` because the reviewer is a property of the section, not
   * of a question — every card in the section gets the same answer, and the card would otherwise need
   * `teamMembers` back just to turn an id into a name.
   *
   * An unreviewed section is closed, not open: with nobody named as reviewer there is nobody whose
   * sign-off it would be. Withdrawing is deliberately *not* gated — see the approval row in
   * `QuestionCard` — so a stale approval never waits on one person.
   */
  const reviewer = sectionReviewer
    ? teamMembers.find((m) => m.id === sectionReviewer)
    : undefined;
  const approveDisabledReason = !sectionReviewer
    ? `Section ${section} has no reviewer yet. Approval is the reviewer's to give, so assign one above first.`
    : sectionReviewer !== myMemberId
    ? `Only ${reviewer?.name ?? "this section's reviewer"} can approve section ${section}.`
    : undefined;

  /**
   * The people one of the two pickers below offers: this project's owners, plus whoever the field
   * already names if that person is not one of them.
   *
   * The union is not a loophole in the restriction — it is what keeps the restriction reversible. A
   * picker resolves its trigger label from the list it was given, so a section held by someone since
   * dropped from the project's owners would otherwise read "Unassigned" while still storing their id:
   * the assignment would be invisible and unclearable, and the section would look free when it was not.
   * Listing them keeps the stale name on screen and the Unassigned option one click away. Nobody new can
   * be added from outside the owners either way.
   */
  function optionsFor(current?: string): TeamMember[] {
    if (!current || assignableMembers.some((m) => m.id === current)) return assignableMembers;
    const held = teamMembers.find((m) => m.id === current);
    return held ? [held, ...assignableMembers] : assignableMembers;
  }

  // Said once, at the point the list is empty, because an empty dropdown otherwise reads as a bug in the
  // dropdown rather than as work that has to happen somewhere else first.
  const noOwnersHint =
    assignableMembers.length === 0
      ? "Nobody is on this project yet. Assign its team on the Overview dashboard first."
      : undefined;

  return (
    <div>
      {/* Section header */}
      <div className="section-header">
        <span className="p-heading--5 u-no-margin--bottom">
          Section {section}
        </span>
        {/* A real section-level owner, stored under `sectionAssignees`. This used to show the assignee
            of the section's *first item*, which read as a section owner but was not one: assigning it
            was impossible, and it changed whenever question one changed hands. */}
        <span className="section-header__block section-header__block--select">
          Assignee:
          {/* The trigger shows the chosen member itself, so there is no second badge with the same
              avatar and name beside it. */}
          <TeamMemberSelect
            label=""
            value={sectionAssignee}
            teamMembers={optionsFor(sectionAssignee)}
            emptyHint={noOwnersHint}
            onSelect={(memberId) => onSaveSectionAssignee(section, memberId)}
            onClear={() => onClearSectionAssignee(section)}
          />
        </span>
        {/* A real section-level reviewer, stored under `sectionReviewers`. Like the assignee beside it
            this used to be read-only text taken from the section's *first item*, so the section could
            not be given a reviewer at all and the one shown changed whenever question one did. */}
        <span className="section-header__block section-header__block--select">
          Reviewer:
          <TeamMemberSelect
            label=""
            value={sectionReviewer}
            teamMembers={optionsFor(sectionReviewer)}
            emptyHint={noOwnersHint}
            onSelect={(memberId) => onSaveSectionReviewer(section, memberId)}
            onClear={() => onClearSectionReviewer(section)}
          />
        </span>
        <span className="section-header__block">
          {items.length} {items.length === 1 ? "Question" : "Questions"}
        </span>
        {approvedCount > 0 && (
          <span className="section-header__block section-header__block--band-approved">
            {approvedCount} Approved
          </span>
        )}
        {readyCount > 0 && (
          <span className="section-header__block section-header__block--band-ready">
            {readyCount} Ready
          </span>
        )}
        {unansweredCount > 0 && (
          <span className="section-header__block section-header__block--band-unanswered">
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
            approved={itemStatus[item.id] === "approved"}
            approveDisabledReason={approveDisabledReason}
            onApprove={onApprove}
            onUnapprove={onUnapprove}
          />
        ))}
      </div>
    </div>
  );
}
