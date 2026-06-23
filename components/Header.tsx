"use client";

import { useState } from "react";
import FileLoader from "./FileLoader";
import { formatDate } from "@/lib/utils";
import { addTeamMember, removeTeamMember } from "@/lib/teamBank";
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
  const [newName, setNewName] = useState("");

  function handleAddMember() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    addTeamMember(trimmed);
    setNewName("");
  }

  function handleRemoveMember(memberId: string) {
    removeTeamMember(memberId);
    revertAssignmentsForMember(memberId);
  }

  return (
    <header className="p-navigation is-sticky app-header">
      <div className="p-navigation__row">
        <div className="p-navigation__banner">
          <div className="p-navigation__tagged-logo">
            <a href="#" className="p-navigation__link app-logo-link" onClick={(e) => e.preventDefault()}>
              <span className="app-logo-icon">
                <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </span>
              <span className="app-logo-title">RAG Snap UI</span>
            </a>
          </div>
        </div>
        <button
          onClick={onToggleDark}
          aria-label="Toggle dark mode"
          className="app-header-toggle"
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
      </div>

      <div className="p-navigation__row">
        <div className="header-meta">
          {/* View toggle */}
          <div className="header-meta__left">
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
          </div>
        </div>
      </div>

      <div className={`p-navigation__row ${activeView === "database" ? "header-meta__hidden" : ""}`}>
        <div className="header-meta">
          {/* Left group: Manage Users + Load JSON + filename badge — always on one line */}
          <div className="header-meta__left">
            {/* Manage users toggle */}
            <div className="header-manage-users">
              <button
                onClick={() => setManagingUsers((m) => !m)}
                aria-pressed={managingUsers}
                className={`u-no-margin--bottom is-dense file-loader__button ${managingUsers ? "p-button--brand" : "p-button--base"}`}
              >
                Manage Users
              </button>

              {managingUsers && (
                <div className="p-card header-manage-users__panel">
                  <div className="filter-bar__add-member">
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddMember(); } }}
                      placeholder="Add team member name"
                      className="u-no-margin--bottom filter-bar__add-input"
                    />
                    <button
                      onClick={handleAddMember}
                      disabled={!newName.trim()}
                      className="p-button--positive u-no-margin--bottom"
                    >
                      Add
                    </button>
                  </div>
                  {teamMembers.length > 0 ? (
                    <ul className="p-list--divided u-no-margin--bottom">
                      {teamMembers.map((m) => (
                        <li key={m.id} className="p-list__item filter-bar__member">
                          <span>{m.name}</span>
                          <button
                            onClick={() => handleRemoveMember(m.id)}
                            title="Remove from team bank"
                            className="p-button--base u-no-margin--bottom is-dense"
                          >
                            <i className="p-icon--close">
                              <span className="u-off-screen">Remove {m.name}</span>
                            </i>
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

            {/* File loader */}
            <FileLoader onLoad={onLoad} />

            {/* Filename badge */}
            <span className={`section-header__block ${data ? "" : "header-meta__hidden"}`}>
              {filename || "filename.json"}
            </span>
          </div>

          {/* Right group: model, date, stats — pushed to right edge */}
          <div className={`header-meta__right ${data ? "" : "header-meta__hidden"}`}>
            <span className="u-text--muted p-text--small">
              <i className="p-icon--code"></i> {data?.model || "model"}
            </span>
            <span className="u-text--muted p-text--small">
              {data ? formatDate(data.generated_at) : "date"}
            </span>
            <span className="p-chip p-chip--positive">
              <span className="p-chip__value">{answeredCount} answered</span>
            </span>
            {unansweredCount > 0 ? (
              <span className="p-chip p-chip--negative">
                <span className="p-chip__value">{unansweredCount} unanswered</span>
              </span>
            ) : (
              <span className="p-chip p-chip--information">
                <span className="p-chip__value">All answered!</span>
              </span>
            )}
            <span className="u-text--muted p-text--small">
              {totalCount} total
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
