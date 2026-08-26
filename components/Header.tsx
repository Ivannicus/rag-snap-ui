"use client";

import { useEffect, useRef, useState } from "react";
import FileLoader from "./FileLoader";
import ShareButton from "./ShareButton";
import ExportButton from "./ExportButton";
import { removeTeamMember } from "@/lib/teamBank";
import { revertAssignmentsForMember } from "@/lib/session";
import type { ParsedQAFile, TeamMember } from "@/lib/types";

export type ActiveView = "inspector" | "database";

interface Props {
  data: ParsedQAFile | null;
  filename: string | null;
  /** Has answer text, no human sign-off yet. */
  readyCount: number;
  /** Human-approved. Only rises when someone clicks Approve. */
  approvedCount: number;
  unansweredCount: number;
  totalCount: number;
  onLoad: (data: ParsedQAFile, filename: string, docId: string) => void;
  teamMembers: TeamMember[];
  /** Null until a doc is open. Present means there is a room to link to. */
  docId: string | null;
  editedAnswers: Record<string, string>;
  ratings: Record<string, number>;
  contextUrls: Record<string, string>;
  onError: (title: string, message: string) => void;
  /** Called with the removed doc's saved-file id, from either removal path. */
  onDocRemoved: (docId: string) => void;
}

export default function Header({
  data,
  filename,
  readyCount,
  approvedCount,
  unansweredCount,
  totalCount,
  onLoad,
  teamMembers,
  docId,
  editedAnswers,
  ratings,
  contextUrls,
  onError,
  onDocRemoved,
}: Props) {
  // Everything is approved only if there is something to approve — an empty file is not "done".
  const allApproved = totalCount > 0 && approvedCount === totalCount;
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
              <FileLoader onLoad={onLoad} onDocRemoved={onDocRemoved} />
              <span className={`section-header__block ${data ? "" : "header-meta__hidden"}`}>
                {filename || "filename.json"}
              </span>
            </div>

            {/* Doc actions, only meaningful once something is open */}
            {data && (
              <div className="header-actions">
                {docId && <ShareButton docId={docId} />}
                <ExportButton
                  data={data}
                  editedAnswers={editedAnswers}
                  ratings={ratings}
                  contextUrls={contextUrls}
                  readyCount={readyCount}
                  unansweredCount={unansweredCount}
                  sourceFilename={filename}
                  docId={docId}
                  onError={onError}
                  onDocRemoved={onDocRemoved}
                />
              </div>
            )}

            {/* Stats */}
            <div className={`header-meta__right ${data ? "" : "header-meta__hidden"}`}>
              {/* Ready and Approved are separate tallies: a freshly loaded file where the model
                  answered everything reads "50 Ready, 0 Approved", and Approved only climbs as
                  someone signs each answer off. */}
              <span className="p-chip p-chip--information u-no-margin--bottom">
                <span className="p-chip__value">{readyCount} Ready</span>
              </span>
              <span className="p-chip p-chip--positive u-no-margin--bottom">
                <span className="p-chip__value">{approvedCount} Approved</span>
              </span>
              {unansweredCount > 0 ? (
                <span className="p-chip p-chip--negative u-no-margin--bottom">
                  <span className="p-chip__value">{unansweredCount} Unanswered</span>
                </span>
              ) : (
                allApproved && (
                  <span className="p-chip p-chip--positive u-no-margin--bottom">
                    <span className="p-chip__value">All Approved!</span>
                  </span>
                )
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
