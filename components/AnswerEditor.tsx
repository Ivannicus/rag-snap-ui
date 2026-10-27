"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { KeyboardEvent, MouseEvent } from "react";

/**
 * The answer editor: a textarea that grows to fit its text, under a small formatting toolbar.
 *
 * Formatting is stored as plain markdown in the answer itself — `**bold**`, `*italic*`, `- ` bullets,
 * `1. ` numbered items — which is what `renderAnswer` in `QuestionCard` draws and what the CSV export
 * carries verbatim. Underline has no markdown form, so it is `<u>…</u>`, which markdown passes through
 * as inline HTML. No rich-text editor: the stored value stays the string it always was, so nothing
 * downstream (export, the dashboard's unanswered test, the live session) has to change.
 */

interface Props {
  value: string;
  onChange: (value: string) => void;
}

type InlineFormat = { open: string; close: string; label: string; shortcut: string };

const BOLD: InlineFormat = { open: "**", close: "**", label: "Bold", shortcut: "b" };
const ITALIC: InlineFormat = { open: "*", close: "*", label: "Italic", shortcut: "i" };
const UNDERLINE: InlineFormat = { open: "<u>", close: "</u>", label: "Underline", shortcut: "u" };

const BULLET_PREFIX = /^[-*]\s+/;
const NUMBER_PREFIX = /^\d+[.)]\s+/;

/**
 * Whether `before` ends with `marker` as a marker of its own. Only italic needs the extra test: its `*`
 * is also the tail of bold's `**`, and toggling italic off beside a bold run must not eat half of it.
 * Three stars is bold-and-italic, and does end with an italic marker.
 */
function endsWithMarker(before: string, marker: string): boolean {
  if (!before.endsWith(marker)) return false;
  if (marker !== "*") return true;
  return !before.endsWith("**") || before.endsWith("***");
}

function startsWithMarker(after: string, marker: string): boolean {
  if (!after.startsWith(marker)) return false;
  if (marker !== "*") return true;
  return !after.startsWith("**") || after.startsWith("***");
}

/**
 * The two list icons. Vanilla has none for lists, so they are drawn here: three rows, each a marker
 * and a line, at 16px — width and height equal, since a square viewBox draws at the smaller of the two.
 * `currentColor` throughout, so they take the button's text colour and follow dark mode.
 */
function BulletListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden focusable="false">
      <circle cx="2.5" cy="3.5" r="1.5" />
      <circle cx="2.5" cy="8" r="1.5" />
      <circle cx="2.5" cy="12.5" r="1.5" />
      <rect x="6" y="2.75" width="9" height="1.5" rx="0.75" />
      <rect x="6" y="7.25" width="9" height="1.5" rx="0.75" />
      <rect x="6" y="11.75" width="9" height="1.5" rx="0.75" />
    </svg>
  );
}

function NumberedListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden focusable="false">
      {/* 1, 2, 3 as strokes rather than <text>, so they do not depend on whichever font is loaded. */}
      <g fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1.6 2.4 L2.6 1.8 V5.2" />
        <path d="M1.5 7.1 Q1.7 6.1 2.6 6.1 Q3.6 6.1 3.5 7 Q3.4 7.6 1.5 9.6 H3.6" />
        <path d="M1.6 11.2 Q2 10.7 2.6 10.7 Q3.5 10.7 3.5 11.5 Q3.5 12.3 2.5 12.3 Q3.6 12.3 3.6 13.2 Q3.6 14.2 2.5 14.2 Q1.9 14.2 1.5 13.7" />
      </g>
      <rect x="6" y="2.75" width="9" height="1.5" rx="0.75" />
      <rect x="6" y="7.25" width="9" height="1.5" rx="0.75" />
      <rect x="6" y="11.75" width="9" height="1.5" rx="0.75" />
    </svg>
  );
}

export default function AnswerEditor({ value, onChange }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  /**
   * Grow the box to its content. `height: auto` first, so it can shrink as well as grow, then the scroll
   * height plus the borders (`box-sizing: border-box` is set on it in the stylesheet, so the borders are
   * inside `height`). The window's scroll position is put back afterwards: collapsing a long box to
   * `auto` for a moment can otherwise pull the page up under the reader.
   */
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const scrollY = window.scrollY;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
    if (window.scrollY !== scrollY) window.scrollTo({ top: scrollY });
  }, []);

  useLayoutEffect(fit, [value, fit]);

  // Re-fit when the box changes width — a window resize, the sidebar, a presence badge arriving —
  // since the same text wraps onto a different number of lines. Width only: re-fitting on the height
  // change that `fit` itself makes would loop.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);

  /**
   * Replace `[start, end)` with `text`, then select `[selStart, selEnd)`.
   *
   * Through `execCommand("insertText")` where the browser supports it, because that goes through the
   * textarea's own editing path: it fires the input event (so `onChange` runs as for typing) and lands
   * on the native undo stack, so Ctrl+Z undoes a Bold click like any keystroke. Setting the value from
   * React instead would wipe that stack. It is deprecated but universally implemented for this; the
   * fallback covers a browser that refuses it.
   */
  function replace(start: number, end: number, text: string, selStart: number, selEnd: number) {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(start, end);
    const inserted = document.execCommand("insertText", false, text);
    if (!inserted) {
      onChange(value.slice(0, start) + text + value.slice(end));
      requestAnimationFrame(() => el.setSelectionRange(selStart, selEnd));
      return;
    }
    el.setSelectionRange(selStart, selEnd);
  }

  /** Wrap the selection in a marker pair, or unwrap it if it is already wrapped. */
  function toggleInline({ open, close }: InlineFormat) {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    const selected = value.slice(start, end);
    const before = value.slice(0, start);
    const after = value.slice(end);

    // Markers just outside the selection: "**|word|**".
    if (endsWithMarker(before, open) && startsWithMarker(after, close)) {
      const from = start - open.length;
      replace(from, end + close.length, selected, from, from + selected.length);
      return;
    }
    // Markers inside it: "|**word**|".
    if (
      selected.length >= open.length + close.length &&
      startsWithMarker(selected, open) &&
      endsWithMarker(selected, close)
    ) {
      const inner = selected.slice(open.length, selected.length - close.length);
      replace(start, end, inner, start, start + inner.length);
      return;
    }
    // Wrap. With nothing selected the caret lands between the markers, ready to type into.
    replace(start, end, open + selected + close, start + open.length, start + open.length + selected.length);
  }

  /**
   * Turn every line the selection touches into a list item, or back into plain lines when they all
   * already are one. Switching between the two list kinds converts rather than stacking prefixes.
   */
  function toggleList(kind: "bullet" | "number") {
    const el = ref.current;
    if (!el) return;
    const lineStart = value.lastIndexOf("\n", el.selectionStart - 1) + 1;
    const nextBreak = value.indexOf("\n", el.selectionEnd);
    const lineEnd = nextBreak === -1 ? value.length : nextBreak;
    const lines = value.slice(lineStart, lineEnd).split("\n");

    const own = kind === "bullet" ? BULLET_PREFIX : NUMBER_PREFIX;
    const content = lines.filter((line) => line.trim() !== "");
    const allListed = content.length > 0 && content.every((line) => own.test(line));

    let n = 0;
    const next = lines.map((line) => {
      const bare = line.replace(BULLET_PREFIX, "").replace(NUMBER_PREFIX, "");
      if (allListed) return bare;
      if (line.trim() === "") return line;
      n += 1;
      return `${kind === "bullet" ? "-" : `${n}.`} ${bare}`;
    });
    const text = next.join("\n");
    replace(lineStart, lineEnd, text, lineStart, lineStart + text.length);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    const format = [BOLD, ITALIC, UNDERLINE].find((f) => f.shortcut === e.key.toLowerCase());
    if (!format) return;
    e.preventDefault();
    toggleInline(format);
  }

  // Each toolbar button cancels its mousedown so the textarea keeps focus and, with it, the selection
  // the button is about to act on.
  const keep = (e: MouseEvent) => e.preventDefault();
  const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

  return (
    <div className="answer-editor">
      <div className="answer-editor__toolbar" role="toolbar" aria-label="Formatting">
        {[BOLD, ITALIC, UNDERLINE].map((format) => (
          <button
            key={format.label}
            type="button"
            onMouseDown={keep}
            onClick={() => toggleInline(format)}
            title={`${format.label} (${mod}${format.shortcut.toUpperCase()})`}
            aria-label={format.label}
            className={`answer-editor__tool answer-editor__tool--${format.label.toLowerCase()}`}
          >
            {format.label[0]}
          </button>
        ))}
        <span className="answer-editor__divider" aria-hidden></span>
        <button
          type="button"
          onMouseDown={keep}
          onClick={() => toggleList("bullet")}
          title="Bulleted list"
          aria-label="Bulleted list"
          className="answer-editor__tool"
        >
          <BulletListIcon />
        </button>
        <button
          type="button"
          onMouseDown={keep}
          onClick={() => toggleList("number")}
          title="Numbered list"
          aria-label="Numbered list"
          className="answer-editor__tool"
        >
          <NumberedListIcon />
        </button>
      </div>
      <textarea
        ref={ref}
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        rows={4}
        className="answer-editor__input u-no-margin--bottom"
      />
    </div>
  );
}
