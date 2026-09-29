"use client";

import React, { useState } from "react";
import ModeToggle from "./ModeToggle";
import { isUnanswered, questionState } from "@/lib/utils";
import type { QAItem } from "@/lib/types";

/** Which of the two answers the card's single box is showing. */
type AnswerMode = "ai" | "edited";

interface Props {
  item: QAItem;
  searchTerm?: string;
  editedAnswer?: string;
  onSaveEdit: (id: string, answer: string) => void;
  onClearEdit: (id: string) => void;
  rating?: number;
  onSaveRating: (id: string, rating: number) => void;
  onClearRating: (id: string) => void;
  /**
   * A previously attached context URL, shown as a badge only. There is no longer any control for
   * setting or clearing one — see the note where the input used to be.
   */
  contextUrl?: string;
  /** True when `itemStatus[item.id] === "approved"`. */
  approved: boolean;
  /**
   * Why this user may not approve, or undefined when they may. Set by `SectionGroup` from the
   * section's reviewer; shown in place of the usual hint beside the button.
   */
  approveDisabledReason?: string;
  onApprove: (id: string) => void;
  onUnapprove: (id: string) => void;
  /** Expansion is owned by AppShell, so it outlives this card's mount and is remembered per doc. */
  open: boolean;
  onSetOpen: (id: string, open: boolean) => void;
}

/** Highlight search term occurrences in text */
function highlight(text: string, term: string): React.ReactNode {
  if (!term.trim()) return text;
  const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? <mark key={i}>{part}</mark> : part
  );
}

/** Render markdown-ish answer with optional search highlighting: bold, bullets, line breaks */
function renderAnswer(text: string, searchTerm: string): React.ReactNode {
  const lines = text.split("\n");
  return lines.map((line, idx) => {
    const isBullet = /^[-*]\s/.test(line);
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
          <li className="answer-bullet">{boldParts}</li>
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
    <button
      onClick={(e) => { e.stopPropagation(); copy(); }}
      title="Copy"
      className="p-button--base is-dense u-no-margin--bottom"
    >
      <i className={copied ? "p-icon--success" : "p-icon--copy"}>
        <span className="u-off-screen">Copy</span>
      </i>
    </button>
  );
}

function StarRating({
  rating,
  onRate,
  onClear,
}: {
  rating: number | undefined;
  onRate: (r: number) => void;
  onClear: () => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const active = hover ?? rating ?? 0;

  return (
    <div className="star-rating">
      <span className="u-text--muted p-text--small u-no-margin--bottom">Rate:</span>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={(e) => {
            e.stopPropagation();
            if (rating === star) onClear();
            else onRate(star);
          }}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(null)}
          title={rating === star ? "Click to clear rating" : `Rate ${star}/5`}
          className={`star-rating__star ${star <= active ? "is-active" : ""}`}
        >
          <svg width="20" height="20" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        </button>
      ))}
      {rating !== undefined && (
        <span className="star-rating__value p-text--small u-no-margin--bottom">
          {rating}/5
        </span>
      )}
    </div>
  );
}

export default function QuestionCard({
  item,
  searchTerm = "",
  editedAnswer,
  onSaveEdit,
  onClearEdit,
  rating,
  onSaveRating,
  onClearRating,
  contextUrl,
  approved,
  approveDisabledReason,
  onApprove,
  onUnapprove,
  open,
  onSetOpen,
}: Props) {
  const [editingRequested, setEditingRequested] = useState(false);
  const [draft, setDraft] = useState("");
  /**
   * Which answer the box shows once there are two. Starts on the edited one, so a card with an edit
   * opens on the answer that counts; only meaningful while `hasEdit`, hence `viewingOriginal` below
   * rather than reading this directly.
   */
  const [answerMode, setAnswerMode] = useState<AnswerMode>("edited");
  const [revertRequested, setRevertRequested] = useState(false);
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);

  const unanswered = isUnanswered(item.answer);
  const hasEdit = editedAnswer !== undefined;
  const state = questionState(item.answer, editedAnswer, approved);

  /**
   * True when the toggle exists and is showing the AI's answer — the one state in which the box holds
   * text that must not be edited. Guarded on `hasEdit` rather than on `answerMode` alone, because
   * before the first edit there is no toggle, and the original is exactly what a first edit starts
   * from.
   */
  const viewingOriginal = hasEdit && answerMode === "ai";

  /**
   * An approved answer is frozen: sign-off is on the exact text that was signed off on, so editing it
   * afterwards would leave an approval standing over words the reviewer never read. Withdraw first.
   *
   * Approval arrives over the live session too, so it is not enough to refuse to *open* the editor —
   * someone else can approve while this card is mid-edit. Derived rather than closed in an effect on
   * `approved`: an effect would take a second render to put the editor away, and for that render an
   * approved answer would still be sitting in an open textarea. `approved` simply wins here.
   *
   * `viewingOriginal` wins the same way and for the same reason: the AI answer is read-only, so the
   * editor cannot be left open over it either. The toggle disables that half while a draft is
   * unsaved, so nothing reaches this — but neither did anything reach the `approved` term until a
   * collaborator's approval did.
   */
  const editing = editingRequested && !approved && !viewingOriginal;
  const confirmingRevert = revertRequested && !approved;

  function setEditing(next: boolean) {
    setEditingRequested(next);
  }

  function setConfirmingRevert(next: boolean) {
    setRevertRequested(next);
  }

  function startEdit() {
    if (approved || viewingOriginal) return;
    setDraft(editedAnswer ?? item.answer);
    setEditing(true);
    onSetOpen(item.id, true);
  }

  function saveEdit() {
    if (draft.trim()) {
      onSaveEdit(item.id, draft.trim());
      // The toggle appears on this save, so put it on the side that was just written rather than
      // wherever it was left last time.
      setAnswerMode("edited");
    }
    setEditing(false);
  }

  function cancelEdit() {
    setEditing(false);
  }

  function requestRevert() {
    if (approved) return;
    setConfirmingRevert(true);
  }

  function confirmRevert() {
    onClearEdit(item.id);
    setEditing(false);
    setConfirmingRevert(false);
  }

  return (
    <>
    <div
      // Hue comes from `questionState`, the one definition of a question's state, so a card's colour
      // and the band it counts towards on the dashboard cannot disagree. `--edited` is additive rather
      // than a fourth state: an edit is a fact about a `ready` answer, not a replacement for it.
      className={`p-card question-card question-card--${state}${
        state === "ready" && hasEdit ? " question-card--edited" : ""
      }`}
    >
      {/* Question row — clickable to expand. Two rows inside, not one: the meta row holds the id, the
          status badges and the chevron, and the question text has the full width of the card beneath
          them. Side by side, the text was a flex item competing with the badges for room, so the same
          question wrapped differently depending on how many badges its card happened to carry. */}
      <button
        onClick={() => onSetOpen(item.id, !open)}
        className="question-card__header"
      >
        <span className="question-card__meta">
          {/* ID badge */}
          <span
            className={`question-card__id-badge ${
              unanswered && !hasEdit ? "question-card__id-badge--negative" : ""
            }`}
          >
            {item.id}
          </span>

          {/* Status badges, as one group so they stay together against the right edge. */}
          <span className="question-card__badges">
            {/* Approved badge. First of the status badges, since sign-off is the state that overrides the
                others: an approved question is done regardless of whether it was edited on the way. */}
            {approved && (
              <span className="section-header__block section-header__block--band-approved">
                <i className="p-icon--success" aria-hidden></i> Approved
              </span>
            )}

            {/* Edited badge */}
            {hasEdit && (
              <span className="section-header__block section-header__block--caution">
                Edited
              </span>
            )}

            {/* Rating badge */}
            {rating !== undefined && (
              <span className="section-header__block section-header__block--gold">
                {rating}/5
                <svg width="12" height="12" fill="currentColor" viewBox="0 0 20 20" className="rating-badge-star">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              </span>
            )}

            {/* Context URL badge */}
            {unanswered && contextUrl && (
              <span className="p-chip p-chip--information">
                <span className="p-chip__value">URL</span>
              </span>
            )}

            {/* Unanswered badge — only if no edit has been applied, and never once approved */}
            {!approved && unanswered && !hasEdit && (
              <span className="section-header__block section-header__block--negative">
                Unanswered
              </span>
            )}
          </span>

          {/* Chevron. The custom class is what keeps it one size: see `.question-card__chevron`. */}
          <i
            className={`question-card__chevron ${
              open ? "p-icon--chevron-up" : "p-icon--chevron-down"
            }`}
          ></i>
        </span>

        {/* Question text — its own row, so nothing above can squeeze it. */}
        <span className="question-card__question">
          {highlight(item.question, searchTerm)}
        </span>
      </button>

      {/* Collapsible answer area */}
      <div className={`question-card__body ${open ? "" : "is-collapsed"}`}>
        <div className="question-card__body-inner">

          {/* ── The answer ──
              One box, never two. Which of the two answers it holds is the toggle's business, and the
              toggle only exists once there is a second answer to choose between: before the first edit
              there is nothing to switch to, and during an edit the box *is* the editor.

              The AI answer is read-only in every state. It is `item.answer` straight from the parsed
              file and is never written to — an edit goes to `editedAnswers` under the item's id — so
              the toggle keeps it viewable for as long as the document exists, however many times it is
              re-edited. */}
          <div>
            {hasEdit && (
              <ModeToggle
                className="question-card__answer-toggle"
                ariaLabel={`Answer shown for question ${item.id}`}
                value={answerMode}
                onChange={setAnswerMode}
                options={[
                  {
                    value: "ai",
                    label: "AI Answer",
                    // Switching away mid-edit would throw a draft away with nothing asked. The
                    // approved-mid-edit path below has to discard one, because approval can arrive
                    // from anyone at any moment and an approved answer cannot sit in an open textarea;
                    // a click on this half has no such excuse, so it waits for Save or Cancel.
                    disabledReason: editing ? "Save or cancel your edit first." : undefined,
                  },
                  { value: "edited", label: "Edited Answer" },
                ]}
              />
            )}

            {editing ? (
              <>
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={Math.max(4, draft.split("\n").length + 1)}
                  className="u-no-margin--bottom"
                />
                <div className="question-card__edit-actions">
                  <button
                    onClick={(e) => { e.stopPropagation(); saveEdit(); }}
                    className="p-button--positive u-no-margin--bottom"
                  >
                    Save edit
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); cancelEdit(); }}
                    className="p-button--base u-no-margin--bottom"
                  >
                    Cancel
                  </button>
                  {hasEdit && (
                    <button
                      onClick={(e) => { e.stopPropagation(); requestRevert(); }}
                      className="p-button--negative u-no-margin--bottom u-push-right"
                    >
                      Revert to original
                    </button>
                  )}
                </div>
              </>
            ) : viewingOriginal || !hasEdit ? (
              /* The AI answer. Muted once an edit exists — and struck through as well when it was a
                 non-answer — since it is then the superseded one of the two, and styled as the plain
                 answer it is before that. Copy is its only control in either case: every writer of
                 `editedAnswers` lives on the Edited Answer side. */
              <div
                className={`question-card__answer ${
                  unanswered
                    ? hasEdit
                      ? "question-card__answer--muted question-card__answer--struck"
                      : "question-card__answer--unanswered"
                    : hasEdit
                    ? "question-card__answer--muted"
                    : ""
                }`}
              >
                {renderAnswer(item.answer, searchTerm)}
                <div className="question-card__answer-actions">
                  <CopyButton text={item.answer} />
                </div>
              </div>
            ) : (
              <div className="question-card__answer question-card__answer--edited">
                {renderAnswer(editedAnswer!, searchTerm)}
                {/* Copy survives approval; the two writers do not — an approved answer is frozen
                    until the approval is withdrawn. */}
                <div className="question-card__answer-actions">
                  <CopyButton text={editedAnswer!} />
                  {!approved && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); startEdit(); }}
                        className="p-button--base is-dense u-no-margin--bottom"
                      >
                        <i className="p-icon--edit"></i> Edit again
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); requestRevert(); }}
                        title="Revert to original"
                        className="p-button--base is-dense u-no-margin--bottom"
                      >
                        <i className="p-icon--close">
                          <span className="u-off-screen">Revert to original</span>
                        </i>
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* The state of the Edit control, for the states that have no control of their own. Each of
              these says why there is nothing to click rather than leaving a gap where a button was, a
              gap reading as a bug. Editing has its own buttons, and the Edited Answer side carries
              Edit again inside the box. */}
          {editing ? null : approved ? (
            /* Frozen. The way back is the Withdraw approval button just below. */
            <p className="u-text--muted p-text--small u-no-margin--bottom">
              <i className="p-icon--lock-locked" aria-hidden></i> Approved answers can&rsquo;t be
              edited. Withdraw the approval below to change this one.
            </p>
          ) : viewingOriginal ? (
            <p className="u-text--muted p-text--small u-no-margin--bottom">
              <i className="p-icon--lock-locked" aria-hidden></i> The AI&rsquo;s answer is read-only.
              Switch to Edited Answer to make changes.
            </p>
          ) : !hasEdit ? (
            <button
              onClick={(e) => { e.stopPropagation(); startEdit(); }}
              className="p-button--link u-no-margin--bottom u-align--left"
            >
              <i className="p-icon--edit"></i> Edit response
            </button>
          ) : null}

          {/* ── Approval ──
              The only writer of `itemStatus`, and so the only way a question reaches the approved band
              on the dashboard. Deliberately separate from the star rating: a rating says how good the
              answer is, approval says it is finished, and one is not the other.

              Approving belongs to the section's reviewer, so the button is disabled for everyone else
              — `approveDisabledReason` says why, and it is the hint text as well as the tooltip,
              because a button that is merely greyed out reads as broken rather than as not-yours.
              Withdrawing is *not* gated: anyone signed in can reopen a question for discussion, which
              keeps a stale approval from waiting on whoever happens to hold the reviewer field. It is
              confirmed instead, since it is open to everyone and undoes someone else's sign-off. */}
          <div className="question-card__section question-card__approval">
            {approved ? (
              <>
                <span className="section-header__block section-header__block--band-approved">
                  <i className="p-icon--success" aria-hidden></i> Approved
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmingWithdraw(true); }}
                  className="p-button--base is-dense u-no-margin--bottom"
                >
                  Withdraw approval
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); onApprove(item.id); }}
                  disabled={approveDisabledReason !== undefined}
                  title={approveDisabledReason}
                  className="p-button--positive is-dense u-no-margin--bottom"
                >
                  <i className="p-icon--success is-light" aria-hidden></i> Approve
                </button>
                <span className="u-text--muted p-text--small u-no-margin--bottom">
                  {approveDisabledReason ??
                    (unanswered && !hasEdit
                      ? "Still unanswered — approve only if no answer is needed."
                      : "Ready for review.")}
                </span>
              </>
            )}
          </div>

          {/* No per-question assignment. Work is handed out a section at a time, in the section
              header — see `sectionAssignees` / `sectionReviewers`. This card used to carry its own
              Assignee and Reviewer selects, which made the same question answerable to two different
              owners depending on which control you looked at. */}

          {/* No context-source-URL input. Unanswered questions used to carry one here, beside the
              rating, for pointing at the document that would answer them. URLs attached before it was
              removed are still stored and still exported; the badge in the header row above is all
              that reads them now. */}

          {/* ── Rating ── */}
          <div className="question-card__section">
            {unanswered && !hasEdit ? (
              <div className="star-rating">
                <span className="u-text--muted p-text--small u-no-margin--bottom">Rate:</span>
                {[1, 2, 3, 4, 5].map((star) => (
                  <svg key={star} className="star-rating__star-icon" width="20" height="20" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                ))}
                <span className="u-text--muted p-text--small u-no-margin--bottom">
                  Not ratable — unanswered
                </span>
              </div>
            ) : (
              <StarRating
                rating={rating}
                onRate={(r) => onSaveRating(item.id, r)}
                onClear={() => onClearRating(item.id)}
              />
            )}
          </div>
        </div>
      </div>
    </div>

    {/* Withdrawing is open to anyone signed in, which is exactly why it asks first: the click undoes
        a sign-off that may not be yours, and only the section's reviewer can put it back. */}
    {confirmingWithdraw && (
      <div className="p-modal" role="dialog" aria-modal="true" aria-labelledby="withdraw-approval-title">
        <div className="p-modal__dialog">
          <header className="p-modal__header">
            <h2 className="p-modal__title" id="withdraw-approval-title">Withdraw approval?</h2>
          </header>
          {/* The `{" "}` is load-bearing: the compiler strips the leading space from a text node that
              starts on a new line, so without it this reads "Question 6will go back". */}
          <p>
            Question {item.id}{" "}
            will go back to needing review, and can be edited again. If it should count as finished,
            the section&rsquo;s reviewer will need to approve it again.
          </p>
          <footer className="p-modal__footer">
            <button
              className="p-button--base u-no-margin--bottom"
              onClick={() => setConfirmingWithdraw(false)}
            >
              Cancel
            </button>
            <button
              className="p-button--negative u-no-margin--bottom"
              onClick={() => {
                onUnapprove(item.id);
                setConfirmingWithdraw(false);
              }}
            >
              Withdraw approval
            </button>
          </footer>
        </div>
      </div>
    )}

    {confirmingRevert && (
      <div className="p-modal" role="dialog" aria-modal="true" aria-labelledby="revert-edit-title">
        <div className="p-modal__dialog">
          <header className="p-modal__header">
            <h2 className="p-modal__title" id="revert-edit-title">Revert to original answer?</h2>
          </header>
          {/* `{" "}` for the same reason as the withdraw dialog above. */}
          <p>
            This will discard your edited answer for question {item.id}{" "}
            and restore the original. This can&rsquo;t be undone.
          </p>
          <footer className="p-modal__footer">
            <button
              className="p-button--base u-no-margin--bottom"
              onClick={() => setConfirmingRevert(false)}
            >
              Cancel
            </button>
            <button
              className="p-button--negative u-no-margin--bottom"
              onClick={confirmRevert}
            >
              Revert
            </button>
          </footer>
        </div>
      </div>
    )}
    </>
  );
}
