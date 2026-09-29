"use client";

import { useEffect, useRef, useState } from "react";
import { removeTeamMember } from "@/lib/teamBank";
import { revertAssignmentsForMember } from "@/lib/session";
import type { TeamMember } from "@/lib/types";

interface Props {
  /** The whole team bank. This control is about the bank itself, not about any one project. */
  teamMembers: TeamMember[];
}

/**
 * The master list of everyone using the tool: who is in the team bank, and removing them from it.
 *
 * This is the old header "Manage Users" control, moved to the Overview dashboard and otherwise
 * unchanged — same label, same brand/base trigger, same per-row Remove, same confirmation modal, same
 * `removeTeamMember` + `revertAssignmentsForMember` pair. It sat in the Collab UI header, which was the
 * wrong place twice over: it is a portfolio-wide administrative action rather than anything to do with
 * the document on screen, and `Header` is hidden on the dashboard, so the tab that owns assignment
 * could not reach it at all. The per-project roster that reader actually wanted is
 * `ProjectTeamPanel`.
 *
 * Note what removing here does and the per-project panel does not: it deletes the person from the bank
 * and then reverts every assignment naming them across every session. Taking somebody off one project
 * is `ProjectTeamPanel`'s Remove, which touches only that project's `projectAssignees`.
 */
export default function ManageUsersPanel({ teamMembers }: Props) {
  const [managingUsers, setManagingUsers] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null);
  const manageUsersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Suppressed while the confirmation is up: the modal is a sibling rendered outside this wrapper, so
    // without the guard a click inside it counts as a click outside and closes the panel behind it.
    if (!managingUsers || memberToRemove) return;
    function handleClickOutside(e: MouseEvent) {
      if (manageUsersRef.current && !manageUsersRef.current.contains(e.target as Node)) {
        e.stopPropagation();
        e.preventDefault();
        setManagingUsers(false);
      }
    }
    document.addEventListener("click", handleClickOutside, true);
    return () => document.removeEventListener("click", handleClickOutside, true);
  }, [managingUsers, memberToRemove]);

  function confirmRemoveMember() {
    if (!memberToRemove) return;
    removeTeamMember(memberToRemove.id);
    revertAssignmentsForMember(memberToRemove.id);
    setMemberToRemove(null);
  }

  return (
    <>
      <div className="manage-users" ref={manageUsersRef}>
        <button
          type="button"
          onClick={() => setManagingUsers((m) => !m)}
          aria-pressed={managingUsers}
          className={`u-no-margin--bottom is-dense file-loader__button ${managingUsers ? "p-button--brand" : "p-button--base"}`}
        >
          Manage Users
        </button>

        {managingUsers && (
          <div className="p-card manage-users__panel">
            {teamMembers.length > 0 ? (
              <ul className="p-list--divided u-no-margin--bottom">
                {teamMembers.map((m) => (
                  <li key={m.id} className="p-list__item filter-bar__member">
                    <span className="filter-bar__member-info">
                      {m.photoURL ? (
                        // Remote avatar, static export — see TeamMemberAvatar.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.photoURL}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="team-member-avatar"
                        />
                      ) : (
                        <span className="team-member-avatar team-member-avatar--placeholder">
                          <i className="p-icon--user"></i>
                        </span>
                      )}
                      <span>{m.name}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setMemberToRemove(m)}
                      aria-label={`Remove ${m.name}`}
                      className="p-button--brand u-no-margin--bottom is-dense"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="u-text--muted p-text--small u-no-margin--bottom">No team members yet.</p>
            )}
          </div>
        )}
      </div>

      {memberToRemove && (
        <div className="p-modal" role="dialog" aria-modal="true" aria-labelledby="remove-member-title">
          <div className="p-modal__dialog">
            <header className="p-modal__header">
              <h2 className="p-modal__title" id="remove-member-title">Remove team member?</h2>
            </header>
            <div className="remove-member-modal__body">
              {memberToRemove.photoURL ? (
                // Remote avatar, static export — see TeamMemberAvatar.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={memberToRemove.photoURL}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="team-member-avatar team-member-avatar--large"
                />
              ) : (
                <span className="team-member-avatar team-member-avatar--large team-member-avatar--placeholder">
                  <i className="p-icon--user"></i>
                </span>
              )}
              <div>
                <p className="u-no-margin--bottom"><strong>{memberToRemove.name}</strong></p>
                <p className="u-text--muted p-text--small u-no-margin--bottom">{memberToRemove.email}</p>
              </div>
            </div>
            <footer className="p-modal__footer">
              <button
                className="p-button--base u-no-margin--bottom"
                onClick={() => setMemberToRemove(null)}
              >
                Cancel
              </button>
              <button
                className="p-button--negative u-no-margin--bottom"
                onClick={confirmRemoveMember}
              >
                Remove
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
