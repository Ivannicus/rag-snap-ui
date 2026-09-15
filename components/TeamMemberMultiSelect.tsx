"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import TeamMemberAvatar from "./TeamMemberAvatar";
import { lockPageScroll } from "@/lib/scrollLock";
import type { TeamMember } from "@/lib/types";

interface Props {
  label: string;
  /** Currently selected member ids. */
  value: string[];
  teamMembers: TeamMember[];
  /** Called with the full next selection, not a delta. */
  onChange: (memberIds: string[]) => void;
  /** Shown on the trigger when nothing is selected. Kept short — the compact trigger is narrow. */
  emptyLabel?: string;
  /**
   * What this control is, for the accessible name. Separate from `emptyLabel` because that has to fit a
   * fixed-width button and so gets abbreviated ("Assign"), which is not what a screen reader should
   * announce the control as. Falls back to `emptyLabel`.
   */
  srName?: string;
  disabled?: boolean;
  /**
   * Fix the trigger's width and summarise the selection as avatars alone.
   *
   * For use in a grid of cards, where a trigger that grew with the selection would reflow the row it
   * sits in every time the team changed.
   */
  compact?: boolean;
}

/**
 * How many avatars the compact trigger shows before it starts counting the rest.
 *
 * Raising this needs the shared `$card-field-width` in globals.scss checked against it: each extra
 * avatar adds its width less the overlap, and the trigger must still fit alongside the "+N" circle and
 * the chevron without the box growing.
 */
const MAX_TRIGGER_AVATARS = 5;

/**
 * A multi-select sibling of `TeamMemberSelect`, for a project's owners.
 *
 * Shares that component's popover mechanics — a `position: fixed` panel placed from the trigger's
 * bounding box, closed on outside click and on scroll, since a panel positioned once at open time
 * cannot follow its trigger down the page. The difference is that choosing does not close the panel:
 * assigning a team of four should be four clicks, not four open-and-reopens.
 */
export default function TeamMemberMultiSelect({
  label,
  value,
  teamMembers,
  onChange,
  emptyLabel = "Unassigned",
  srName,
  disabled = false,
  compact = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const selected = teamMembers.filter((m) => value.includes(m.id));

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: globalThis.MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        e.stopPropagation();
        e.preventDefault();
        setOpen(false);
      }
    }
    document.addEventListener("click", handleClickOutside, true);
    return () => document.removeEventListener("click", handleClickOutside, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleScroll(e: Event) {
      if (wrapperRef.current && wrapperRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [open]);

  // ...and while it is open, hold the page still, so the only thing a wheel can move is the member list.
  // Without this, scrolling to the end of the list chained to the document, the page moved, and the
  // effect above shut the panel mid-choice — worse here than in `TeamMemberSelect`, since picking a team
  // of four is meant to be four clicks in one open panel. See `lockPageScroll`.
  useEffect(() => {
    if (!open) return;
    return lockPageScroll();
  }, [open]);

  function handleToggleOpen(e: MouseEvent) {
    e.stopPropagation();
    if (disabled) return;
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPanelPosition({ top: rect.bottom + 8, left: rect.left });
    }
    setOpen((o) => !o);
  }

  function toggleMember(e: MouseEvent, memberId: string) {
    e.stopPropagation();
    onChange(
      value.includes(memberId) ? value.filter((id) => id !== memberId) : [...value, memberId]
    );
  }

  function clearAll(e: MouseEvent) {
    e.stopPropagation();
    onChange([]);
  }

  const shown = selected.slice(0, MAX_TRIGGER_AVATARS);
  const overflow = selected.length - shown.length;

  return (
    <div
      className={`team-member-select${compact ? " team-member-select--compact" : ""}`}
      ref={wrapperRef}
    >
      {label && <span className="u-text--muted p-text--small">{label}</span>}
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggleOpen}
        aria-expanded={open}
        disabled={disabled}
        // The compact trigger shows faces rather than names, so the names have to reach a screen reader
        // some other way. Each avatar also carries a title for a hover.
        aria-label={
          selected.length > 0
            ? `${srName ?? emptyLabel}: ${selected.map((m) => m.name).join(", ")}`
            : `${srName ?? emptyLabel}: nobody selected`
        }
        // `is-empty` centres the placeholder in the box. With a selection the avatars sit left and the
        // chevron right, which is the arrangement a fixed-width summary wants; with nothing selected
        // that left-hugging single word looked like a mistake in an otherwise empty button.
        className={`team-member-select__trigger p-button--base is-dense u-no-margin--bottom${
          selected.length === 0 ? " is-empty" : ""
        }`}
      >
        {selected.length > 0 ? (
          <span className="member-stack">
            {shown.map((m) => (
              <span key={m.id} className="member-stack__item" title={m.name}>
                <TeamMemberAvatar member={m} size="small" />
              </span>
            ))}
            {overflow > 0 && (
              <span className="member-stack__overflow" title={`${overflow} more`}>
                +{overflow}
              </span>
            )}
          </span>
        ) : (
          <span className="team-member-select__trigger-label">{emptyLabel}</span>
        )}
        {/* A name alongside the avatars would make the trigger's content vary with the selection, which
            is the thing the fixed width exists to prevent. The full list is one click away. */}
        {!compact && selected.length > 0 && (
          <span className="team-member-select__trigger-label">
            {selected.length === 1 ? selected[0].name : `${selected.length} owners`}
          </span>
        )}
        <i className={open ? "p-icon--chevron-up" : "p-icon--chevron-down"}></i>
      </button>

      {open && panelPosition && (
        <div
          className="p-card team-member-select__panel"
          style={{ top: panelPosition.top, left: panelPosition.left }}
        >
          <ul className="team-member-select__list">
            <li>
              <button
                type="button"
                onClick={clearAll}
                className="team-member-select__option"
                disabled={value.length === 0}
              >
                Clear all
              </button>
            </li>
            {teamMembers.length === 0 && (
              <li>
                <span className="team-member-select__option u-text--muted">
                  No team members yet
                </span>
              </li>
            )}
            {teamMembers.map((m) => {
              const isSelected = value.includes(m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={(e) => toggleMember(e, m.id)}
                    aria-pressed={isSelected}
                    className={`team-member-select__option${
                      isSelected ? " is-selected" : ""
                    }`}
                  >
                    <i
                      className={isSelected ? "p-icon--success" : "p-icon--minus"}
                      aria-hidden
                    ></i>
                    <TeamMemberAvatar member={m} />
                    <span>{m.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
