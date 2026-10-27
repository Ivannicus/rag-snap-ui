"use client";

import QuestionCard from "./QuestionCard";
import TeamMemberSelect from "./TeamMemberSelect";
import { questionState } from "@/lib/utils";
import type { PresenceEditor, PresenceUser } from "@/lib/presence";
import type { ItemStatus, QAItem, QuestionComment, SectionInfo, TeamMember } from "@/lib/types";

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
  /** item.id → the *other* people who have that question's editor open. */
  questionEditors: Record<string, PresenceEditor[]>;
  /** The signed-in user as a presence entry, for their own avatar on their own open editor. */
  myPresence?: PresenceUser;
  /** item.id -> that question's comment thread, oldest first. */
  comments: Record<string, QuestionComment[]>;
  onAddComment: (id: string, text: string) => Promise<void>;
  onSetCommentResolved: (id: string, commentId: string, resolved: boolean) => void;
  onDeleteComment: (id: string, commentId: string) => void;
  /** Take the lock on a question's editor; resolves false when somebody else holds it. */
  onClaimEditing: (id: string) => Promise<(() => void) | null>;
  /** Hold the lock while an editor is open; the returned teardown releases it. */
  onPublishEditing: (id: string) => () => void;
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
  questionEditors,
  myPresence,
  comments,
  onAddComment,
  onSetCommentResolved,
  onDeleteComment,
  onClaimEditing,
  onPublishEditing,
}: Props) {
  // The section's own tallies, through `questionState` so they are the same three disjoint buckets the
  // dashboard counts and the card hues use. Ready and Approved are counted separately: a section is
  // only finished when its Ready count reaches zero, which a single "Answered" figure could not show.
  const counts = { unanswered: 0, ready: 0, approved: 0 };
  for (const item of items) {
    counts[questionState(item.answer, editedAnswers[item.id], itemStatus[item.id] === "approved")]++;
  }

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
    ? "Assign a reviewer to approve."
    : sectionReviewer !== myMemberId
    ? `Only ${reviewer?.name ?? "the reviewer"} can approve.`
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
    // The container the header's layout queries: one row when the section is wide enough for every
    // slot, two when it is not, a wrapping row below that. See `.section-header` in globals.scss.
    <div className="section-group">
      {/* Section header. Every box has its own fixed slot, so nothing moves with a name's length or a
          count's digits and the toggle always sits at the far right. */}
      <div className="section-header">
        {/* The title cell is the one elastic slot: the label takes what it needs (ellipsed past that, with
            the full label on hover) and the rule fills the rest. */}
        <div className="section-header__title">
          <span className="p-heading--5 u-no-margin--bottom section-header__label" title={section.label}>
            {section.label}
          </span>
          <div className="section-header__rule" />
        </div>

        {/* Assignee and reviewer, one clickable box each. Both read straight off the section's
            identity, so every question in the section shows the same assignment however the list is
            filtered. The offered list is the project's owners, not the whole bank — see `optionsFor`. */}
        <div className="section-header__slot section-header__slot--assignee">
          <TeamMemberSelect
            label="Assignee:"
            value={sectionAssignee}
            teamMembers={optionsFor(sectionAssignee)}
            emptyHint={noOwnersHint}
            onSelect={(memberId) => onSaveSectionAssignee(section.key, memberId)}
            onClear={() => onClearSectionAssignee(section.key)}
          />
        </div>
        <div className="section-header__slot section-header__slot--reviewer">
          <TeamMemberSelect
            label="Reviewer:"
            value={sectionReviewer}
            teamMembers={optionsFor(sectionReviewer)}
            emptyHint={noOwnersHint}
            onSelect={(memberId) => onSaveSectionReviewer(section.key, memberId)}
            onClear={() => onClearSectionReviewer(section.key)}
          />
        </div>

        <span className="section-header__slot section-header__slot--questions section-header__block">
          <span className="section-header__count">{items.length}</span>
          {items.length === 1 ? "Question" : "Questions"}
        </span>
        {/* The three bands, always all three, in `STATUS_BANDS` order. A band at zero keeps its box and
            says 0, but drops its tint and fades: the slot stays put, so the boxes after it do not slide
            left, and the colour is kept for counts that mean something. Band tints are the dashboard's
            own, so a section's badges and a project's ring cannot disagree about a state's colour.

            No Edited badge here: edits are shown on each question card, and a fourth count crowded the
            row for something the three bands already account for. */}
        {(
          [
            ["approved", "Approved"],
            ["ready", "Ready"],
            ["unanswered", "Unanswered"],
          ] as const
        ).map(([band, label]) => (
          <span
            key={band}
            className={`section-header__slot section-header__slot--${band} section-header__block ${
              counts[band] > 0
                ? `section-header__block--band-${band}`
                : "section-header__block--zero"
            }`}
          >
            <span className="section-header__count">{counts[band]}</span>
            {label}
          </span>
        ))}

        {/* Whole-section toggle. Last in the row, past the rule, so it sits at the right edge. */}
        <button
          type="button"
          onClick={() => onSetOpen(section.key, !open)}
          aria-expanded={open}
          aria-controls={panelId}
          title={open ? "Collapse section" : "Expand section"}
          className="section-header__slot section-header__slot--toggle section-header__toggle"
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
            editors={questionEditors[item.id]}
            myPresence={myPresence}
            comments={comments[item.id]}
            onAddComment={onAddComment}
            onSetCommentResolved={onSetCommentResolved}
            onDeleteComment={onDeleteComment}
            onClaimEditing={onClaimEditing}
            onPublishEditing={onPublishEditing}
          />
        ))}
      </div>
    </div>
  );
}
