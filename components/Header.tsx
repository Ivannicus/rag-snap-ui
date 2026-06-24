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
  darkMode: boolean;
  onToggleDark: () => void;
  teamMembers: TeamMember[];
  activeView: ActiveView;
  onChangeView: (view: ActiveView) => void;
}

export default function Header({
  data,
  filename,
  unansweredCount,
  totalCount,
  onLoad,
  darkMode,
  onToggleDark,
  teamMembers,
  activeView,
  onChangeView,
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
    <header className="p-navigation is-sticky app-header">
      <div className="p-navigation__row app-header__row">
        <span className="app-logo-icon">
          <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </span>
        <span className="app-logo-title">RAG Snap UI</span>
        <button
          onClick={onToggleDark}
          aria-label="Toggle dark mode"
          className="app-header-toggle u-no-margin--bottom"
        >
          {darkMode ? (
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 20 20">
              <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
            </svg>
          )}
        </button>

        {/* Manage users toggle — pinned, always visible, not part of the scrollable section */}
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
                  {teamMembers.map((m) => {
                    console.log("TeamMember photoURL:", m.id, m.photoURL);
                    return (
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
                    );
                  })}
                </ul>
              ) : (
                <p className="u-text--muted p-text--small u-no-margin--bottom">No team members yet.</p>
              )}
            </div>
          )}
        </div>

        <div className="header-meta">
          {/* Left group: Load JSON + filename badge — always on one line */}
          <div className="header-meta__left">
            {/* File loader */}
            <FileLoader onLoad={onLoad} />

            {/* Filename badge */}
            <span className={`section-header__block ${data ? "" : "header-meta__hidden"}`}>
              {filename || "filename.json"}
            </span>
          </div>

          {/* View toggle */}
          <div className="view-toggle">
            <button
              onClick={() => onChangeView("inspector")}
              className={`u-no-margin--bottom is-dense file-loader__button ${activeView === "inspector" ? "p-button--brand" : "p-button--base"}`}
            >
              File Inspector
            </button>
            <button
              onClick={() => onChangeView("database")}
              className={`u-no-margin--bottom is-dense file-loader__button ${activeView === "database" ? "p-button--brand" : "p-button--base"}`}
            >
              RFP Database
            </button>
          </div>

          {/* Right group: stats — pushed to right edge */}
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
