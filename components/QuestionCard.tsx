"use client";

import React, { useState } from "react";
import TeamMemberSelect from "./TeamMemberSelect";
import { isUnanswered } from "@/lib/utils";
import type { QAItem, TeamMember } from "@/lib/types";

interface Props {
  item: QAItem;
  searchTerm?: string;
  editedAnswer?: string;
  onSaveEdit: (id: string, answer: string) => void;
  onClearEdit: (id: string) => void;
  rating?: number;
  onSaveRating: (id: string, rating: number) => void;
  onClearRating: (id: string) => void;
  contextUrl?: string;
  onSaveContextUrl: (id: string, url: string) => void;
  onClearContextUrl: (id: string) => void;
  assignee?: string;
  onSaveAssignee: (id: string, memberId: string) => void;
  onClearAssignee: (id: string) => void;
  reviewer?: string;
  onSaveReviewer: (id: string, memberId: string) => void;
  onClearReviewer: (id: string) => void;
  teamMembers: TeamMember[];
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

function ContextUrlRow({
  url,
  onSave,
  onClear,
}: {
  url: string | undefined;
  onSave: (url: string) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState(url ?? "");
  const [editing, setEditing] = useState(!url);

  function handleSave() {
    const trimmed = draft.trim();
    if (trimmed) {
      onSave(trimmed);
      setEditing(false);
    }
  }

  function handleClear() {
    onClear();
    setDraft("");
    setEditing(true);
  }

  if (!editing && url) {
    return (
      <div className="context-url-row">
        <i className="p-icon--external-link"></i>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="u-truncate context-url-row__link"
        >
          {url}
        </a>
        <button
          onClick={(e) => { e.stopPropagation(); setDraft(url); setEditing(true); }}
          title="Edit URL"
          className="p-button--base is-dense u-no-margin--bottom"
        >
          <i className="p-icon--edit">
            <span className="u-off-screen">Edit URL</span>
          </i>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); handleClear(); }}
          title="Remove URL"
          className="p-button--base is-dense u-no-margin--bottom"
        >
          <i className="p-icon--delete">
            <span className="u-off-screen">Remove URL</span>
          </i>
        </button>
      </div>
    );
  }

  return (
    <div className="context-url-row">
      <input
        type="url"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); handleSave(); }
          if (e.key === "Escape") { e.preventDefault(); if (url) { setDraft(url); setEditing(false); } }
        }}
        onClick={(e) => e.stopPropagation()}
        placeholder="https://docs.example.com/..."
        className="u-no-margin--bottom context-url-row__input"
      />
      <button
        onClick={(e) => { e.stopPropagation(); handleSave(); }}
        disabled={!draft.trim()}
        className="p-button--positive is-dense u-no-margin--bottom"
      >
        Save
      </button>
      {url && (
        <button
          onClick={(e) => { e.stopPropagation(); setDraft(url); setEditing(false); }}
          className="p-button--base is-dense u-no-margin--bottom"
        >
          Cancel
        </button>
      )}
    </div>
  );
}

function AssignmentRow({
  assignee,
  reviewer,
  teamMembers,
  onSaveAssignee,
  onClearAssignee,
  onSaveReviewer,
  onClearReviewer,
}: {
  assignee?: string;
  reviewer?: string;
  teamMembers: TeamMember[];
  onSaveAssignee: (memberId: string) => void;
  onClearAssignee: () => void;
  onSaveReviewer: (memberId: string) => void;
  onClearReviewer: () => void;
}) {
  return (
    <div className="assignment-row">
      <TeamMemberSelect
        label="Assignee:"
        value={assignee}
        teamMembers={teamMembers}
        onSelect={onSaveAssignee}
        onClear={onClearAssignee}
      />
      <TeamMemberSelect
        label="Reviewer:"
        value={reviewer}
        teamMembers={teamMembers}
        onSelect={onSaveReviewer}
        onClear={onClearReviewer}
      />
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
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmingRevert, setConfirmingRevert] = useState(false);

  const unanswered = isUnanswered(item.answer);
  const hasEdit = editedAnswer !== undefined;

  function startEdit() {
    setDraft(editedAnswer ?? item.answer);
    setEditing(true);
    setOpen(true);
  }

  function saveEdit() {
    if (draft.trim()) {
      onSaveEdit(item.id, draft.trim());
    }
    setEditing(false);
  }

  function cancelEdit() {
    setEditing(false);
  }

  function requestRevert() {
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
      className={`p-card question-card ${
        unanswered && !hasEdit
          ? "question-card--unanswered"
          : hasEdit
          ? "question-card--edited"
          : ""
      }`}
    >
      {/* Question row — clickable to expand */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="question-card__header"
      >
        {/* ID badge */}
        <span
          className={`question-card__id-badge ${
            unanswered && !hasEdit ? "question-card__id-badge--negative" : ""
          }`}
        >
          {item.id}
        </span>

        {/* Question text */}
        <span className="question-card__question">
          {highlight(item.question, searchTerm)}
        </span>

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

        {/* Unanswered badge — only if no edit has been applied */}
        {unanswered && !hasEdit && (
          <span className="section-header__block section-header__block--negative">
            Unanswered
          </span>
        )}

        {/* Chevron */}
        <i className={open ? "p-icon--chevron-up" : "p-icon--chevron-down"}></i>
      </button>

      {/* Collapsible answer area */}
      <div className={`question-card__body ${open ? "" : "is-collapsed"}`}>
        <div className="question-card__body-inner">

          {/* ── Original answer ── */}
          <div>
            {hasEdit && (
              <p className="p-text--small-caps">Original</p>
            )}
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
          </div>

          {/* ── Edited answer (shown when a saved edit exists) ── */}
          {hasEdit && !editing && (
            <div>
              <p className="p-text--small-caps">Edited</p>
              <div className="question-card__answer question-card__answer--edited">
                {renderAnswer(editedAnswer!, searchTerm)}
                <div className="question-card__answer-actions">
                  <CopyButton text={editedAnswer!} />
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
                </div>
              </div>
            </div>
          )}

          {/* ── Edit textarea (open when editing) ── */}
          {editing ? (
            <div>
              <p className="p-text--small-caps">
                {hasEdit ? "Re-editing" : "New edit"}
              </p>
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
            </div>
          ) : (
            !hasEdit && (
              <button
                onClick={(e) => { e.stopPropagation(); startEdit(); }}
                className="p-button--link u-no-margin--bottom u-align--left"
              >
                <i className="p-icon--edit"></i> Edit response
              </button>
            )
          )}

          {/* ── Assignment ── */}
          <div className="question-card__section">
            <p className="p-text--small-caps">Assignment</p>
            <AssignmentRow
              assignee={assignee}
              reviewer={reviewer}
              teamMembers={teamMembers}
              onSaveAssignee={(memberId) => onSaveAssignee(item.id, memberId)}
              onClearAssignee={() => onClearAssignee(item.id)}
              onSaveReviewer={(memberId) => onSaveReviewer(item.id, memberId)}
              onClearReviewer={() => onClearReviewer(item.id)}
            />
          </div>

          {/* ── Context URL — only for originally unanswered questions ── */}
          {unanswered && (
            <div className="question-card__section">
              <p className="p-text--small-caps">Context source URL</p>
              <ContextUrlRow
                url={contextUrl}
                onSave={(url) => onSaveContextUrl(item.id, url)}
                onClear={() => onClearContextUrl(item.id)}
              />
            </div>
          )}

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

    {confirmingRevert && (
      <div className="p-modal" role="dialog" aria-modal="true" aria-labelledby="revert-edit-title">
        <div className="p-modal__dialog">
          <header className="p-modal__header">
            <h2 className="p-modal__title" id="revert-edit-title">Revert to original answer?</h2>
          </header>
          <p>
            This will discard your edited answer for question {item.id} and restore the original.
            This can&rsquo;t be undone.
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
