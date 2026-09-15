"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import TeamMemberAvatar from "./TeamMemberAvatar";
import type { TeamMember } from "@/lib/types";

interface Props {
  label: string;
  value?: string;
  teamMembers: TeamMember[];
  onSelect: (memberId: string) => void;
  onClear: () => void;
}

export default function TeamMemberSelect({
  label,
  value,
  teamMembers,
  onSelect,
  onClear,
}: Props) {
  const [open, setOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const selected = teamMembers.find((m) => m.id === value);

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

  // Close on scroll, since the panel is position:fixed at coordinates computed
  // once at open time and won't track the trigger button as the page scrolls.
  // Ignores scroll events from inside the panel's own member list.
  useEffect(() => {
    if (!open) return;
    function handleScroll(e: Event) {
      if (wrapperRef.current && wrapperRef.current.contains(e.target as Node)) {
        return;
      }
      setOpen(false);
    }
    window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [open]);

  function handleToggleOpen(e: MouseEvent) {
    e.stopPropagation();
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPanelPosition({ top: rect.bottom + 8, left: rect.left });
    }
    setOpen((o) => !o);
  }

  function handleChoose(e: MouseEvent, memberId: string) {
    e.stopPropagation();
    if (memberId) onSelect(memberId);
    else onClear();
    setOpen(false);
  }

  return (
    <div className="team-member-select" ref={wrapperRef}>
      {/* The label sits inside the button so the whole box is the click target, not just the name.
          A bare <button> is used rather than p-button--base, whose own padding, border radius and
          hover colours would fight the square section-header box styling. */}
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggleOpen}
        aria-expanded={open}
        aria-haspopup="true"
        className="team-member-select__trigger u-no-margin--bottom"
      >
        <span className="team-member-select__label">{label}</span>
        {selected && <TeamMemberAvatar member={selected} size="small" />}
        <span className="team-member-select__trigger-label">
          {selected ? selected.name : "Unassigned"}
        </span>
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
                onClick={(e) => handleChoose(e, "")}
                className="team-member-select__option"
              >
                Unassigned
              </button>
            </li>
            {teamMembers.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={(e) => handleChoose(e, m.id)}
                  className="team-member-select__option"
                >
                  <TeamMemberAvatar member={m} />
                  <span>{m.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
