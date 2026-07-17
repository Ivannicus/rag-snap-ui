"use client";

import { useEffect, useRef, useState } from "react";
import FileLoader from "./FileLoader";
import { removeTeamMember } from "@/lib/teamBank";
import { revertAssignmentsForMember } from "@/lib/session";
import type { ParsedQAFile, TeamMember } from "@/lib/types";

export type ActiveView = "inspector" | "database";

interface Props {
  data: ParsedQAFile | null;
  filename: string | null;
  unansweredCount: number;
  totalCount: number;
  onLoad: (data: ParsedQAFile, filename: string) => void;
  teamMembers: TeamMember[];
}

export default function Header({
  data,
  filename,
  unansweredCount,
  totalCount,
  onLoad,
  teamMembers,
}: Props) {
  const answeredCount = totalCount - unansweredCount;
  const [managingUsers, setManagingUsers] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null);
  const manageUsersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
      <header className="app-header">
        <div className="app-header__row">
          {/* Manage users */}
          <div className="header-manage-users" ref={manageUsersRef}>
            <button
              onClick={() => setManagingUsers((m) => !m)}
              aria-pressed={managingUsers}
              className={`u-no-margin--bottom is-dense file-loader__button ${managingUsers ? "p-button--brand" : "p-button--base"}`}
            >
              Manage Users
            </button>

            {managingUsers && (
              <div className="p-card header-manage-users__panel">
                {teamMembers.length > 0 ? (
                  <ul className="p-list--divided u-no-margin--bottom">
                    {teamMembers.map((m) => (
                      <li key={m.id} className="p-list__item filter-bar__member">
                        <span className="filter-bar__member-info">
                          {m.photoURL ? (
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

          <div className="header-meta">
            {/* File loader + filename */}
            <div className="header-meta__left">
              <FileLoader onLoad={onLoad} />
              <span className={`section-header__block ${data ? "" : "header-meta__hidden"}`}>
                {filename || "filename.json"}
              </span>
            </div>

            {/* Stats */}
            <div className={`header-meta__right ${data ? "" : "header-meta__hidden"}`}>
              <span className="p-chip p-chip--positive u-no-margin--bottom">
                <span className="p-chip__value">{answeredCount} Answered</span>
              </span>
              {unansweredCount > 0 ? (
                <span className="p-chip p-chip--negative u-no-margin--bottom">
                  <span className="p-chip__value">{unansweredCount} Unanswered</span>
                </span>
              ) : (
                <span className="p-chip p-chip--information u-no-margin--bottom">
                  <span className="p-chip__value">All Answered!</span>
                </span>
              )}
              <span className="u-text--muted p-text--small u-no-margin--bottom">
                {totalCount} Total
              </span>
            </div>
          </div>
        </div>
      </header>

      {memberToRemove && (
        <div className="p-modal" role="dialog" aria-modal="true" aria-labelledby="remove-member-title">
          <div className="p-modal__dialog">
            <header className="p-modal__header">
              <h2 className="p-modal__title" id="remove-member-title">Remove team member?</h2>
            </header>
            <div className="remove-member-modal__body">
              {memberToRemove.photoURL ? (
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
