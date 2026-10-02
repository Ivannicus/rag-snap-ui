"use client";

import FileLoader from "./FileLoader";
import ShareButton from "./ShareButton";
import ExportButton from "./ExportButton";
import ProjectTeamPanel from "./ProjectTeamPanel";
import type { ParsedQAFile, TeamMember } from "@/lib/types";

export type ActiveView = "overview" | "inspector" | "database";

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
  /** The whole team bank, for the project team panel's add list. */
  teamMembers: TeamMember[];
  /**
   * The people on the open project — `AppShell`'s `assignableMembers`, the same list the section
   * pickers are gated on, so the header and those pickers cannot disagree about who is on it.
   */
  assignableMembers: TeamMember[];
  /** Replace the open project's owners with exactly these ids. */
  onChangeProjectOwners: (memberIds: string[]) => void;
  /** Null until a doc is open. Present means there is a room to link to. */
  docId: string | null;
  editedAnswers: Record<string, string>;
  ratings: Record<string, number>;
  contextUrls: Record<string, string>;
  onError: (title: string, message: string) => void;
  /** Called with the removed doc's saved-file id, from either removal path. */
  onDocRemoved: (docId: string) => void;
  /** Called once an export has been archived, so the dashboard can re-read its lists. */
  onExported: () => void;
  /** Start creating a project. Passed straight through to the Projects dropdown. */
  onNewProject: () => void;
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
  assignableMembers,
  onChangeProjectOwners,
  docId,
  editedAnswers,
  ratings,
  contextUrls,
  onError,
  onDocRemoved,
  onExported,
  onNewProject,
}: Props) {
  // Everything is approved only if there is something to approve — an empty file is not "done".
  const allApproved = totalCount > 0 && approvedCount === totalCount;

  return (
    <header className="app-header">
      <div className="app-header__row">
        {/* The open project's team. The global user bank moved to the Overview dashboard
            (`ManageUsersPanel`) — this is who is on *this* project, and it writes the same
            `projectAssignees` the dashboard's owner pickers do. */}
        <ProjectTeamPanel
          assignedMembers={assignableMembers}
          teamMembers={teamMembers}
          onChangeOwners={onChangeProjectOwners}
          disabled={!docId}
        />

        <div className="header-meta">
          {/* File loader + filename */}
          <div className="header-meta__left">
            <FileLoader
              onLoad={onLoad}
              onDocRemoved={onDocRemoved}
              onExported={onExported}
              onNewProject={onNewProject}
            />
            {/* Capped and truncating — see `.header-meta__filename`. A long project name used to grow
                the row until `.header-meta` started scrolling, taking the export controls and the
                tallies off the right-hand edge with it. `title` is how the full name stays reachable
                once it is clipped. */}
            <span
              className={`section-header__block header-meta__filename ${
                data ? "" : "header-meta__hidden"
              }`}
              title={filename || undefined}
            >
              {/* The ellipsis lives on this child, not on the badge: the badge is an inline flex
                  container and `text-overflow` applies to block containers only, so on the badge
                  itself it would clip with no ellipsis. Same reason
                  `.project-list__filename-text` exists. */}
              <span className="header-meta__filename-text">{filename || "filename.json"}</span>
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
                onExported={onExported}
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
  );
}
