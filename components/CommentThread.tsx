"use client";

import { useState } from "react";
import TeamMemberAvatar from "./TeamMemberAvatar";
import { formatTimestamp } from "@/lib/utils";
import type { QuestionComment } from "@/lib/types";

interface Props {
  /** The question this thread belongs to, for labelling the form. */
  questionId: string;
  /** Oldest first, as `subscribeToSession` decodes them. Missing means no comments yet. */
  comments?: QuestionComment[];
  /** The signed-in user's TeamMember.id, or undefined before the team bank has said who that is. */
  myMemberId?: string;
  onAdd: (text: string) => void;
  onSetResolved: (commentId: string, resolved: boolean) => void;
  onDelete: (commentId: string) => void;
}

/**
 * A question's comments: critiques for whoever answered it, and the reviewer's reasons for not
 * approving it. Anyone signed in may comment, resolve and reopen; only a comment's author may delete it.
 *
 * Open comments come first, oldest first, so the thread reads as a conversation. Resolved ones drop to
 * the bottom and fade — still there to read, but no longer asking for anything. Not gated on approval:
 * a signed-off answer can still collect a note for next time.
 */
export default function CommentThread({
  questionId,
  comments = [],
  myMemberId,
  onAdd,
  onSetResolved,
  onDelete,
}: Props) {
  const [draft, setDraft] = useState("");

  const open = comments.filter((c) => !c.resolved);
  const resolved = comments.filter((c) => c.resolved);
  const canComment = myMemberId !== undefined;

  function submit() {
    const text = draft.trim();
    if (!text || !canComment) return;
    onAdd(text);
    setDraft("");
  }

  return (
    <div className="comment-thread">
      <p className="comment-thread__heading p-text--small-caps u-no-margin--bottom">
        Comments
        {comments.length > 0 && (
          <span className="u-text--muted">
            {" "}· {open.length} open{resolved.length > 0 ? `, ${resolved.length} resolved` : ""}
          </span>
        )}
      </p>

      {comments.length > 0 && (
        <ul className="comment-thread__list p-list">
          {[...open, ...resolved].map((comment) => (
            <li
              key={comment.id}
              className={`comment-thread__item${comment.resolved ? " is-resolved" : ""}`}
            >
              <div className="comment-thread__meta">
                <TeamMemberAvatar
                  member={{ name: comment.authorName, photoURL: comment.authorPhoto }}
                  size="small"
                />
                <span className="comment-thread__author">{comment.authorName}</span>
                <span className="u-text--muted p-text--small u-no-margin--bottom">
                  {formatTimestamp(comment.createdAt)}
                </span>
                <span className="comment-thread__actions">
                  {comment.resolved ? (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSetResolved(comment.id, false); }}
                      className="p-button--base is-dense u-no-margin--bottom"
                    >
                      Reopen
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSetResolved(comment.id, true); }}
                      disabled={!canComment}
                      className="p-button--base is-dense u-no-margin--bottom"
                    >
                      <i className="p-icon--success" aria-hidden></i> Resolve
                    </button>
                  )}
                  {comment.authorId === myMemberId && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onDelete(comment.id); }}
                      title="Delete your comment"
                      className="p-button--base is-dense u-no-margin--bottom"
                    >
                      <i className="p-icon--delete">
                        <span className="u-off-screen">Delete comment</span>
                      </i>
                    </button>
                  )}
                </span>
              </div>
              <p className="comment-thread__text u-no-margin--bottom">{comment.text}</p>
              {comment.resolved && (
                <p className="comment-thread__resolved u-text--muted p-text--small u-no-margin--bottom">
                  <i className="p-icon--success" aria-hidden></i> Resolved by {comment.resolved.byName}
                  {" · "}
                  {formatTimestamp(comment.resolved.at)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="comment-thread__form">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Ctrl/⌘+Enter posts; plain Enter is a newline, since a critique can run to a few lines.
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder={canComment ? "Leave a comment…" : "Loading your profile…"}
          disabled={!canComment}
          aria-label={`Comment on question ${questionId}`}
          className="comment-thread__input u-no-margin--bottom"
        />
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); submit(); }}
          disabled={!canComment || !draft.trim()}
          className="p-button--positive is-dense u-no-margin--bottom"
        >
          Comment
        </button>
      </div>
    </div>
  );
}
