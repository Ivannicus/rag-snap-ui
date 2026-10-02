"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TeamMember } from "@/lib/types";

interface Props {
  /**
   * The people on this project, already resolved to bank entries.
   *
   * This is `AppShell`'s `assignableMembers` memo — the bank filtered by `projectAssignees`, in bank
   * order, with stale owner ids dropped. Passed in rather than derived here so there is exactly one
   * definition of "who is on this project", shared with the section pickers that are gated on it.
   */
  assignedMembers: TeamMember[];
  /** The whole bank, for the add list. Anyone not already on the project can be put on it. */
  teamMembers: TeamMember[];
  /**
   * The full next owner list, never a delta — the same contract `TeamMemberMultiSelect` uses, so both
   * writers of `projectAssignees` hand their caller the same shape.
   */
  onChangeOwners: (memberIds: string[]) => void;
  /** No open document means no room to write to, so the control has nothing to manage. */
  disabled: boolean;
}

/**
 * Who is on the project currently open, and adding or removing them.
 *
 * Reads and writes the same `sessions/<id>/projectAssignees` the Overview dashboard's owner pickers do,
 * so the two are one source of truth: adding somebody here shows up on their card over there without a
 * reload, and vice versa. That works because the write is a per-key merge patch rather than a whole-map
 * `set` — see `setProjectAssignees` — so this view and the dashboard editing different owners at the
 * same moment cannot clobber each other.
 *
 * **Remove here means unassign from this project**, not delete from the tool. The person stays in the
 * team bank and on their other projects; taking somebody out of the bank altogether is the Overview
 * dashboard's `ManageUsersPanel`, which this control was split out of.
 *
 * Two explicit lists rather than a `TeamMemberMultiSelect`: that would be a dropdown inside a dropdown,
 * and its panel is dismissed by its own outside-click listener, which would fight this one's. The rows
 * are the same markup the bank list uses, so the two panels still read as the same control.
 */
export default function ProjectTeamPanel({
  assignedMembers,
  teamMembers,
  onChangeOwners,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const assignedIds = useMemo(() => assignedMembers.map((m) => m.id), [assignedMembers]);

  /**
   * The bank minus the people already on the project.
   *
   * Compared by id against `assignedMembers` rather than against the raw map, so somebody holding a
   * stale owner id — assigned, then removed from the bank — cannot appear in both lists at once.
   */
  const addableMembers = useMemo(
    () => teamMembers.filter((m) => !assignedIds.includes(m.id)),
    [teamMembers, assignedIds]
  );

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        e.stopPropagation();
        e.preventDefault();
        setOpen(false);
      }
    }
    document.addEventListener("click", handleClickOutside, true);
    return () => document.removeEventListener("click", handleClickOutside, true);
  }, [open]);

  // Both emit the whole next list. The panel stays open either way: staffing a project is several
  // clicks, and closing after each one would make it several open-and-reopens.
  function addMember(memberId: string) {
    onChangeOwners([...assignedIds, memberId]);
  }

  function removeMember(memberId: string) {
    onChangeOwners(assignedIds.filter((id) => id !== memberId));
  }

  return (
    <div className="header-manage-users" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-pressed={open}
        disabled={disabled}
        title={disabled ? "Open a project to manage its team members" : undefined}
        className={`u-no-margin--bottom is-dense file-loader__button ${open ? "p-button--brand" : "p-button--base"}`}
      >
        Manage Team Members
      </button>

      {open && (
        <div className="p-card header-manage-users__panel">
          <p className="u-text--muted p-text--small project-team__heading">On this project</p>
          {assignedMembers.length > 0 ? (
            <ul className="p-list--divided u-no-margin--bottom">
              {assignedMembers.map((m) => (
                <li key={m.id} className="p-list__item filter-bar__member">
                  <span className="filter-bar__member-info">
                    <MemberAvatar member={m} />
                    <span>{m.name}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeMember(m.id)}
                    aria-label={`Remove ${m.name} from this project`}
                    className="p-button--brand u-no-margin--bottom is-dense"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="u-text--muted p-text--small u-no-margin--bottom">
              Nobody is on this project yet.
            </p>
          )}

          <p className="u-text--muted p-text--small project-team__heading">Add to project</p>
          {teamMembers.length === 0 ? (
            <p className="u-text--muted p-text--small u-no-margin--bottom">No team members yet.</p>
          ) : addableMembers.length > 0 ? (
            <ul className="p-list--divided u-no-margin--bottom">
              {addableMembers.map((m) => (
                <li key={m.id} className="p-list__item filter-bar__member">
                  <span className="filter-bar__member-info">
                    <MemberAvatar member={m} />
                    <span>{m.name}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => addMember(m.id)}
                    aria-label={`Add ${m.name} to this project`}
                    className="p-button--positive u-no-margin--bottom is-dense"
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="u-text--muted p-text--small u-no-margin--bottom">
              Everyone in the team bank is already on this project.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The row avatar, as the bank list draws it.
 *
 * Local rather than `TeamMemberAvatar` because both lists here want the plain 1.5rem row treatment that
 * the bank panel already uses, and factoring it out keeps the two lists' markup from drifting apart.
 */
function MemberAvatar({ member }: { member: TeamMember }) {
  if (!member.photoURL) {
    return (
      <span className="team-member-avatar team-member-avatar--placeholder">
        <i className="p-icon--user"></i>
      </span>
    );
  }
  return (
    // Remote avatar, static export — see TeamMemberAvatar.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={member.photoURL}
      alt=""
      referrerPolicy="no-referrer"
      className="team-member-avatar"
    />
  );
}
