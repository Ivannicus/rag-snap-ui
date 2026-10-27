"use client";

import React, { useEffect, useRef, useState } from "react";
import ModeToggle from "./ModeToggle";
import TeamMemberAvatar from "./TeamMemberAvatar";
import AnswerEditor from "./AnswerEditor";
import CommentThread from "./CommentThread";
import { isUnanswered, questionState } from "@/lib/utils";
import { thisTabId, type PresenceEditor, type PresenceUser } from "@/lib/presence";
import type { QAItem, QuestionComment } from "@/lib/types";

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
  /**
   * Every other tab with this question's editor open right now — other people, and this same user in
   * another tab or on another device. Never this tab. While there is anyone here, every writer of this
   * answer on this card is locked.
   */
  editors?: PresenceEditor[];
  /**
   * The signed-in user, shown first in the corner of their own open editor and labelled "(you)". Kept
   * apart from `editors` because it must never lock this user out of their own box.
   */
  myPresence?: PresenceUser;
  /** This question's comment thread, oldest first. Missing means nobody has commented. */
  comments?: QuestionComment[];
  /** Rejects when the comment did not reach the server, so the thread can give its text back. */
  onAddComment: (id: string, text: string) => Promise<void>;
  onSetCommentResolved: (id: string, commentId: string, resolved: boolean) => void;
  onDeleteComment: (id: string, commentId: string) => void;
  /**
   * Take the lock on this question's editor. Resolves to a release for a claim the card ends up not
   * using, or null when another tab got there first.
   */
  onClaimEditing: (id: string) => Promise<(() => void) | null>;
  /** Hold the lock for as long as the editor is open; the returned teardown releases it. */
  onPublishEditing: (id: string) => () => void;
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

/**
 * Inline formatting: `**bold**`, `*italic*`, `<u>underline</u>` — what `AnswerEditor`'s toolbar writes.
 * Bold is tried before italic so `**` is never read as two italic markers. Italic's markers must hug
 * their text (`*word*`, not `5 * 3 * 2`), so arithmetic and stray asterisks in an AI answer stay literal.
 * Bold's closing `**` may not be followed by a third star: italic ending inside a bold run writes
 * `**bold *italic***`, and without that the bold would close one star early and strand the italic.
 *
 * **No lookbehind.** Italic used to end in `(?<=[^\s*])`, and Safari before 16.4 cannot parse a
 * lookbehind at all — a regex literal is compiled as the module loads, so it was not answers that failed
 * there but the whole app. The same rule is spelled forwards instead: the content's first and last
 * characters are each matched as `[^\s*]`, with the optional middle between them.
 */
const INLINE = /\*\*(.+?)\*\*(?!\*)|<u>(.+?)<\/u>|\*([^\s*](?:.*?[^\s*])?)\*/;

function renderInline(text: string, searchTerm: string, keyPrefix = ""): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let rest = text;
  let i = 0;
  while (rest) {
    const match = INLINE.exec(rest);
    if (!match) {
      out.push(<React.Fragment key={`${keyPrefix}${i}`}>{highlight(rest, searchTerm)}</React.Fragment>);
      break;
    }
    if (match.index > 0) {
      out.push(
        <React.Fragment key={`${keyPrefix}${i++}`}>{highlight(rest.slice(0, match.index), searchTerm)}</React.Fragment>
      );
    }
    const key = `${keyPrefix}${i++}`;
    const [, bold, underline, italic] = match;
    // Recursive, so formats nest: `**bold *and italic***`, `<u>**both**</u>`.
    if (bold !== undefined) out.push(<strong key={key}>{renderInline(bold, searchTerm, `${key}.`)}</strong>);
    else if (underline !== undefined) out.push(<u key={key}>{renderInline(underline, searchTerm, `${key}.`)}</u>);
    else out.push(<em key={key}>{renderInline(italic, searchTerm, `${key}.`)}</em>);
    rest = rest.slice(match.index + match[0].length);
  }
  return out;
}

const BULLET_LINE = /^[-*]\s+/;
const NUMBER_LINE = /^(\d+)[.)]\s+/;

/**
 * Render a markdown-ish answer with optional search highlighting: the inline formats above, `- ` / `* `
 * bullets, `1. ` numbered items, and line breaks. Consecutive list lines become one real `<ul>` / `<ol>`
 * — the bullets used to be bare `<li>`s with no list around them.
 *
 * Two things keep a numbered list's numbers the ones in the text, as the CSV has them. Blank lines
 * between items of one list do not end it — AI answers often space their items out, and each item used
 * to become a list of its own. And every item carries its written number as `value`, so a list that is
 * genuinely interrupted by a paragraph still carries on at 3 rather than restarting at 1.
 */
function renderAnswer(text: string, searchTerm: string): React.ReactNode {
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const kind = BULLET_LINE.test(lines[i]) ? "ul" : NUMBER_LINE.test(lines[i]) ? "ol" : null;
    if (kind) {
      const prefix = kind === "ul" ? BULLET_LINE : NUMBER_LINE;
      const items: React.ReactNode[] = [];
      while (i < lines.length) {
        const match = prefix.exec(lines[i]);
        if (match) {
          items.push(
            <li key={i} value={kind === "ol" ? Number(match[1]) : undefined}>
              {renderInline(lines[i].slice(match[0].length), searchTerm)}
            </li>
          );
          i++;
          continue;
        }
        // Blank lines followed by another item of the same list are spacing inside it, not its end.
        let next = i;
        while (next < lines.length && !lines[next].trim()) next++;
        if (next > i && next < lines.length && prefix.test(lines[next])) {
          i = next;
          continue;
        }
        break;
      }
      const List = kind;
      blocks.push(<List key={`list-${i}`} className="answer-list">{items}</List>);
      continue;
    }
    // A run of plain lines, kept as one block with the breaks between them.
    const run: React.ReactNode[] = [];
    while (i < lines.length && !BULLET_LINE.test(lines[i]) && !NUMBER_LINE.test(lines[i])) {
      if (run.length) run.push(<br key={`br-${i}`} />);
      run.push(<React.Fragment key={i}>{renderInline(lines[i], searchTerm)}</React.Fragment>);
      i++;
    }
    blocks.push(<span key={`text-${i}`} className="answer-text">{run}</span>);
  }
  return blocks;
}

/**
 * The avatars of whoever else is in this question's edit box, for the corner of whichever box is on
 * screen. Each avatar is a hover/focus target whose tooltip gives that person's full name — the face
 * alone is not always enough, and a placeholder avatar has no face at all.
 *
 * The tooltip opens *down and inward*: `.question-card` and its body both clip their overflow, so one
 * opening upwards or outwards from a corner would be cut off.
 */
function PresenceBadges({
  editors,
  meId,
  corner,
}: {
  editors: PresenceEditor[];
  /** Whose avatar is the signed-in user's own, so its tooltip can say so. */
  meId?: string;
  corner: "left" | "right";
}) {
  const tab = thisTabId();
  return (
    <span className={`question-card__presence question-card__presence--${corner} member-stack`}>
      {editors.map((editor) => {
        const label =
          editor.tabId === tab
            ? `${editor.name} (you)`
            : editor.memberId === meId
              ? `${editor.name} (you, in another tab)`
              : `${editor.name} is editing`;
        return (
          <span
            // By tab: one person can hold two entries, from two tabs.
            key={editor.tabId}
            // Focusable so the name is reachable from the keyboard as well; Vanilla shows the message on
            // `:focus` as well as `:hover`.
            tabIndex={0}
            aria-label={label}
            className={`member-stack__item ${corner === "right" ? "p-tooltip--btm-right" : "p-tooltip"}`}
          >
            <TeamMemberAvatar member={editor} size="small" />
            <span className="p-tooltip__message" role="tooltip" aria-hidden>
              {label}
            </span>
          </span>
        );
      })}
    </span>
  );
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
  editors,
  myPresence,
  comments,
  onAddComment,
  onSetCommentResolved,
  onDeleteComment,
  onClaimEditing,
  onPublishEditing,
}: Props) {
  const [editingRequested, setEditingRequested] = useState(false);
  /** A claim on the lock is in flight. Blocks a second click from sending a second one. */
  const [claiming, setClaiming] = useState(false);
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

  /**
   * ...and once approval has closed the editor, it stays closed. Deriving `editing` alone left
   * `editingRequested` set underneath the approval, so withdrawing it reopened the editor with the old
   * draft — and published presence for it without ever claiming the lock, which then held everyone else
   * out for as long as that tab stayed open. Dropping the request discards the draft, as approval always
   * has. The revert dialog is dropped for the same reason. Set during render rather than in an effect, so
   * no render ever has an approved answer and a live request at once.
   */
  if (approved && (editingRequested || revertRequested)) {
    setEditingRequested(false);
    setRevertRequested(false);
  }
  /** The box is showing the AI's answer: before the first edit, or on the toggle's AI Answer side. */
  const showRating = !editing && (!hasEdit || viewingOriginal);

  const busy = editors !== undefined && editors.length > 0;
  const openComments = comments?.filter((c) => !c.resolved).length ?? 0;

  /**
   * Why Approve is disabled, if it is. The section's reason first — not the reviewer, or no reviewer —
   * since it is the one that holds whatever happens on this card. Then open comments: an answer cannot
   * be signed off while somebody's critique of it is still unaddressed, so they are resolved first.
   *
   * Only *approving* waits on comments. An answer already approved when a comment arrives stays approved
   * — withdrawing it is a deliberate, confirmed act, never a side effect — and Withdraw is not gated.
   */
  //
  // Nor while the answer is mid-edit, by anyone: approving would close that editor and throw its draft
  // away, and sign-off belongs on the text that is actually going to stand. The reset above still covers
  // the race where an approval lands before the editor's presence has reached the approver.
  const approveBlockedReason =
    approveDisabledReason ??
    (editing
      ? "Save or cancel your edit to approve."
      : busy
        ? editors!.every((editor) => editor.memberId === myPresence?.memberId)
          ? "Save or cancel your edit in the other tab to approve."
          : "Someone is editing this answer. Approve once they’re done."
        : openComments > 0
          ? `Resolve ${openComments === 1 ? "the open comment" : `all ${openComments} open comments`} to approve.`
          : undefined);
  // Who the open editor's corner shows: me first, then anyone who got in alongside me (only a lost race
  // can produce one). The card is outlined whenever anyone at all — me included — has the editor open.
  const editorBadges: PresenceEditor[] =
    editing && myPresence ? [{ ...myPresence, tabId: thisTabId() }, ...(editors ?? [])] : editors ?? [];
  const outlined = busy || (editing && myPresence !== undefined);

  /**
   * Somebody else has this question's editor open, so this user may not change the answer: not open the
   * editor, not Edit, not Revert. One editor per question — two drafts of one answer would mean the
   * second Save silently overwrote the first. Never set while this user is editing: their own lock is
   * not in `editors`, and a lost race that let both in still lets both finish.
   */
  const lockedBy = !editing && busy ? editors : undefined;
  // My own other tab locks this one like anyone else, but naming me to myself would read as a bug.
  const lockedByOthers = lockedBy?.filter((editor) => editor.memberId !== myPresence?.memberId) ?? [];
  const lockReason = !lockedBy
    ? undefined
    : lockedByOthers.length === 0
      ? "You are editing this answer in another tab or window. Save or cancel there to edit it here."
      : `${lockedByOthers.map((editor) => editor.name).join(" and ")} ${
          lockedByOthers.length === 1 ? "is" : "are"
        } editing this answer. You can edit it once they’re done.`;
  const confirmingRevert = revertRequested && !approved && !lockedBy;

  /**
   * The AI answer must be rated before anyone edits it, so every edit starts from a judgement of what the
   * AI produced. Any rating counts — ratings are one per question, not per person — and an unanswered AI
   * answer is exempt, since there is nothing there to rate.
   */
  const needsRating = !unanswered && rating === undefined;
  const editBlockedReason =
    lockReason ??
    (needsRating
      ? // An edit made before this rule may have no rating, and the stars are not shown on the Edited
        // Answer side — so say where they are.
        hasEdit
        ? "Rate the AI answer before editing. Switch to AI Answer to rate it."
        : "Rate the AI answer before editing it."
      : undefined);

  /**
   * Hold the lock for exactly as long as the editor is open — through an effect rather than from the
   * buttons that open and close it, because the editor can close with no click at all: `editing` is
   * derived, so a collaborator's approval closes it with no event, and a filter change or a doc switch
   * unmounts the card outright. The cleanup releases the lock on every one of those paths.
   *
   * The open editor, not focus: switching windows mid-draft must not hand the box to somebody else.
   */
  useEffect(() => {
    if (!editing) return;
    return onPublishEditing(item.id);
  }, [editing, item.id, onPublishEditing]);

  /**
   * What `startEdit` needs to know once its claim comes back, which is not what it knew when it was
   * clicked: the card may have gone (a filter change, a doc switch) or the answer been approved meanwhile.
   * Read only after the await, and written in an effect, never during render.
   */
  const claimContext = useRef({ mounted: false, blocked: false });
  useEffect(() => {
    claimContext.current.blocked = approved || viewingOriginal;
  }, [approved, viewingOriginal]);
  useEffect(() => {
    const context = claimContext.current;
    context.mounted = true;
    return () => {
      context.mounted = false;
    };
  }, []);

  function setEditing(next: boolean) {
    setEditingRequested(next);
  }

  function setConfirmingRevert(next: boolean) {
    setRevertRequested(next);
  }

  async function startEdit() {
    if (approved || viewingOriginal || editBlockedReason || claiming) return;
    setClaiming(true);
    const release = await onClaimEditing(item.id);
    setClaiming(false);
    // Lost the race: somebody else's claim committed first. Their presence is already on its way, and
    // when it lands this card shows the lock line naming them, so there is nothing more to say here.
    if (!release) return;
    // Won it, but there is no longer an editor to open. Nothing would ever publish over this claim or
    // tear it down, so give it back now rather than locking everyone else out until it goes stale.
    const { mounted, blocked } = claimContext.current;
    if (!mounted || blocked) {
      release();
      return;
    }
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
    if (approved || lockedBy) return;
    setConfirmingRevert(true);
  }

  function confirmRevert() {
    onClearEdit(item.id);
    setEditing(false);
    setConfirmingRevert(false);
  }

  /**
   * The one Edit control, beside Copy in whichever answer box can be edited: the plain AI answer before
   * the first edit, the Edited Answer after it. Same button, same place, either way — it used to be a
   * blue "Edit response" link under an unedited answer and an "Edit again" button inside an edited one.
   * Disabled while somebody else holds the lock (their name is the tooltip) or a claim is in flight.
   */
  const editButton = (
    <button
      onClick={(e) => { e.stopPropagation(); startEdit(); }}
      disabled={editBlockedReason !== undefined || claiming}
      title={editBlockedReason ?? "Edit answer"}
      className="p-button--base is-dense u-no-margin--bottom"
    >
      <i className="p-icon--edit"></i> Edit
    </button>
  );

  return (
    <>
    <div
      // Hue comes from `questionState`, the one definition of a question's state, so a card's colour
      // and the band it counts towards on the dashboard cannot disagree. `--edited` is additive rather
      // than a fourth state: an edit is a fact about a `ready` answer, not a replacement for it.
      className={`p-card question-card question-card--${state}${
        state === "ready" && hasEdit ? " question-card--edited" : ""
      }${outlined ? " question-card--busy" : ""}`}
    >
      {/* Question row — clickable to expand. Two rows inside, not one: the meta row holds the id, the
          status badges and the chevron, and the question text has the full width of the card beneath
          them. Side by side, the text was a flex item competing with the badges for room, so the same
          question wrapped differently depending on how many badges its card happened to carry. */}
      <button
        onClick={() => onSetOpen(item.id, !open)}
        className={`question-card__header${open ? " is-open" : ""}`}
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
            {/* Open comments: something on this question is waiting to be addressed. First, since it is
                the one badge asking somebody to act. Gone once every comment is resolved — a resolved
                thread is history, not a to-do. */}
            {openComments > 0 && (
              <span
                className="section-header__block section-header__block--comments"
                title={`${openComments} unresolved ${openComments === 1 ? "comment" : "comments"}`}
              >
                <i className="p-icon--comments" aria-hidden></i> {openComments} Unresolved
              </span>
            )}

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
                {/* Wrapped so the presence badge has a box to sit in the corner of: the right end of the
                    formatting toolbar, clear of the text. */}
                <div className="question-card__editor">
                  <AnswerEditor value={draft} onChange={setDraft} />
                  {editorBadges.length > 0 && (
                    <PresenceBadges editors={editorBadges} meId={myPresence?.memberId} corner="right" />
                  )}
                </div>
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
                 answer it is before that. Before the first edit it carries the Edit button beside
                 Copy; once an edit exists it is read-only and Copy is its only control, since every
                 writer of `editedAnswers` then lives on the Edited Answer side. */
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
                {busy && <PresenceBadges editors={editors} meId={myPresence?.memberId} corner="left" />}
                <div className="question-card__answer-actions">
                  <CopyButton text={item.answer} />
                  {!hasEdit && !approved && editButton}
                </div>
              </div>
            ) : (
              <div className="question-card__answer question-card__answer--edited">
                {renderAnswer(editedAnswer!, searchTerm)}
                {busy && <PresenceBadges editors={editors} meId={myPresence?.memberId} corner="left" />}
                {/* Copy survives approval; the two writers do not — an approved answer is frozen
                    until the approval is withdrawn. */}
                <div className="question-card__answer-actions">
                  <CopyButton text={editedAnswer!} />
                  {!approved && (
                    <>
                      {editButton}
                      <button
                        onClick={(e) => { e.stopPropagation(); requestRevert(); }}
                        disabled={lockedBy !== undefined}
                        title={lockReason ?? "Revert to original"}
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
              gap reading as a bug. Editing has its own buttons, and otherwise Edit sits beside Copy in
              the answer box. */}
          {editing ? null : approved ? (
            /* Frozen. The way back is the Withdraw approval button just below. */
            <p className="u-text--muted p-text--small u-no-margin--bottom">
              <i className="p-icon--lock-locked" aria-hidden></i> Approved answers can&rsquo;t be
              edited. Withdraw the approval below to change this one.
            </p>
          ) : lockReason ? (
            /* Someone else has the editor open. Ahead of the read-only note below: whichever side of
               the toggle is showing, this is the reason there is nothing to click right now. */
            <p className="u-text--muted p-text--small u-no-margin--bottom">
              <i className="p-icon--lock-locked" aria-hidden></i> {lockReason}
            </p>
          ) : viewingOriginal ? (
            <p className="u-text--muted p-text--small u-no-margin--bottom">
              <i className="p-icon--lock-locked" aria-hidden></i> The AI&rsquo;s answer is read-only.
              Switch to Edited Answer to make changes.
            </p>
          ) : null}

          {/* ── Rating ──
              A rating is of the AI's answer, so it is shown only while the box is showing that answer:
              always before the first edit (there is no toggle yet), and afterwards only on the AI Answer
              side. Switching to Edited Answer takes it away and Approve moves up into its place. Hidden
              while the editor is open too, since the box is then the draft, not the AI's answer.

              Above Approve, because it comes first: Edit stays disabled until the AI answer has a
              rating (`needsRating`), so the rating is the first thing anybody does to a question. An
              unanswered AI answer has nothing to rate, so its stars are greyed and it is exempt —
              otherwise a blank could never be filled in. */}
          {showRating && (
            <div className="question-card__section question-card__rating">
              {unanswered ? (
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
                <>
                  <StarRating
                    rating={rating}
                    onRate={(r) => onSaveRating(item.id, r)}
                    onClear={() => onClearRating(item.id)}
                  />
                  {needsRating && !approved && (
                    <span className="question-card__rating-hint u-text--muted p-text--small u-no-margin--bottom">
                      Rate the AI answer to start editing.
                    </span>
                  )}
                </>
              )}
            </div>
          )}

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
                  disabled={approveBlockedReason !== undefined}
                  title={approveBlockedReason}
                  className="p-button--positive is-dense u-no-margin--bottom"
                >
                  <i className="p-icon--success is-light" aria-hidden></i> Approve
                </button>
                <span className="u-text--muted p-text--small u-no-margin--bottom">
                  {approveBlockedReason ??
                    (unanswered && !hasEdit
                      ? "Still unanswered — approve only if no answer is needed."
                      : "Ready for review.")}
                </span>
              </>
            )}
          </div>

          {/* ── Comments ──
              Under the approval row, where a reviewer who will not approve says why. Open to anyone
              signed in, and independent of approval and of the editor lock: a comment changes nothing
              about the answer itself. */}
          <div className="question-card__section">
            <CommentThread
              questionId={item.id}
              comments={comments}
              myMemberId={myPresence?.memberId}
              onAdd={(text) => onAddComment(item.id, text)}
              onSetResolved={(commentId, resolved) => onSetCommentResolved(item.id, commentId, resolved)}
              onDelete={(commentId) => onDeleteComment(item.id, commentId)}
            />
          </div>

          {/* No per-question assignment. Work is handed out a section at a time, in the section
              header — see `sectionAssignees` / `sectionReviewers`. This card used to carry its own
              Assignee and Reviewer selects, which made the same question answerable to two different
              owners depending on which control you looked at. */}

          {/* No context-source-URL input. Unanswered questions used to carry one here, beside the
              rating, for pointing at the document that would answer them. URLs attached before it was
              removed are still stored and still exported; the badge in the header row above is all
              that reads them now. */}

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
