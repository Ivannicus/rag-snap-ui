"use client";

import QuestionCard from "./QuestionCard";
import TeamMemberSelect from "./TeamMemberSelect";
import { questionState } from "@/lib/utils";
import type { ItemStatus, QAItem, SectionInfo, TeamMember } from "@/lib/types";

interface Props {
  section: SectionInfo;
  /** Position in the rendered list. Only used to mint a unique DOM id for this section's panel. */
  index: number;
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
  /** item.id -> "approved". A missing id means ready (if answered) or unanswered (if blank). */
  itemStatus: Record<string, ItemStatus>;
  onApprove: (id: string) => void;
  onUnapprove: (id: string) => void;
  /** Ids of the cards that are expanded. Missing id means collapsed. */
  expandedIds: Record<string, true>;
  onSetExpanded: (id: string, open: boolean) => void;
  /**
   * Whether this section's questions are shown. Independent of `expandedIds`: hiding the list
   * leaves each card's own expansion alone, so re-opening the section restores it as it was.
   */
  open: boolean;
  onSetOpen: (sectionKey: string, open: boolean) => void;
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
  index,
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
  expandedIds,
  onSetExpanded,
  open,
  onSetOpen,
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
  // The section's own tallies, through `questionState` so they are the same three disjoint buckets the
  // dashboard counts and the card hues use. Ready and Approved are counted separately: a section is
  // only finished when its Ready count reaches zero, which a single "Answered" figure could not show.
  const counts = { unanswered: 0, ready: 0, approved: 0 };
  for (const item of items) {
    counts[questionState(item.answer, editedAnswers[item.id], itemStatus[item.id] === "approved")]++;
  }
  const editedCount = items.filter((i) => editedAnswers[i.id] !== undefined).length;

  // Keyed on list position, not on section.key. Keys are used verbatim from explicit labels, so they
  // carry spaces and punctuation an id cannot; squeezing those out collides — "A/B" and "A B" both
  // reduce to "A-B", as do the split part "3~2" and a hyphen-delimited section "3-2" — and a
  // duplicate id points aria-controls at whichever panel the document happens to reach first.
  const panelId = `section-cards-${index}`;

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
    ? `${section.label} has no reviewer yet. Approval is the reviewer's to give, so assign one above first.`
    : sectionReviewer !== myMemberId
    ? `Only ${reviewer?.name ?? "this section's reviewer"} can approve ${section.label}.`
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
        <span className="p-heading--5 u-no-margin--bottom">{section.label}</span>

        {/* Assignee and reviewer, one clickable box each. Both read straight off the section's
            identity, so every question in the section shows the same assignment however the list is
            filtered. The offered list is the project's owners, not the whole bank — see `optionsFor`. */}
        <TeamMemberSelect
          label="Assignee:"
          value={sectionAssignee}
          teamMembers={optionsFor(sectionAssignee)}
          emptyHint={noOwnersHint}
          onSelect={(memberId) => onSaveSectionAssignee(section.key, memberId)}
          onClear={() => onClearSectionAssignee(section.key)}
        />
        <TeamMemberSelect
          label="Reviewer:"
          value={sectionReviewer}
          teamMembers={optionsFor(sectionReviewer)}
          emptyHint={noOwnersHint}
          onSelect={(memberId) => onSaveSectionReviewer(section.key, memberId)}
          onClear={() => onClearSectionReviewer(section.key)}
        />

        <span className="section-header__block">
          {items.length} {items.length === 1 ? "Question" : "Questions"}
        </span>
        {/* Band tints, the same three the dashboard sizes its ring with, so a section's badges and a
            project's progress cannot read as different colours for the same state. */}
        {counts.approved > 0 && (
          <span className="section-header__block section-header__block--band-approved">
            {counts.approved} Approved
          </span>
        )}
        {counts.ready > 0 && (
          <span className="section-header__block section-header__block--band-ready">
            {counts.ready} Ready
          </span>
        )}
        {counts.unanswered > 0 && (
          <span className="section-header__block section-header__block--band-unanswered">
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
          type="button"
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
      <div id={panelId} className={`section-cards ${open ? "" : "is-collapsed"}`}>
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
            open={expandedIds[item.id] === true}
            onSetOpen={onSetExpanded}
          />
        ))}
      </div>
    </div>
  );
}
