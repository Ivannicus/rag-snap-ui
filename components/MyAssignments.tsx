"use client";

import { assignmentsForMember } from "@/lib/projects";
import type { ProjectSummary, TeamMember } from "@/lib/types";

interface Props {
  /** The signed-in user's team-bank entry, or null if they are not in the bank yet. */
  me: TeamMember | null;
  projects: ProjectSummary[];
  onOpenProject: (projectId: string) => void;
}

/**
 * What the signed-in user has been given to do, across every active project.
 *
 * Built entirely from overlays the dashboard is already subscribed to, so it costs no extra reads and
 * updates live as work is assigned. Two things can land here: sections you own, and projects you own.
 *
 * It used to also count the individual questions assigned to you, which is gone with the per-question
 * assignment it read. Counting the questions *inside* your sections instead would need a per-section
 * item count, which is not denormalized into project metadata — and loading a document to work it out
 * is exactly what the dashboard may not do.
 */
export default function MyAssignments({ me, projects, onOpenProject }: Props) {
  if (!me) {
    return (
      <div className="p-notification--information u-no-margin--bottom">
        <div className="p-notification__content">
          <p className="p-notification__message">
            You are not in the team bank yet, so nothing can be assigned to you. Your entry is added
            automatically the first time you sign in.
          </p>
        </div>
      </div>
    );
  }

  const entries = assignmentsForMember(
    me.id,
    projects.map((p) => ({ meta: p.meta, overlays: p.overlays }))
  );

  if (entries.length === 0) {
    return (
      <p className="u-text--muted u-no-margin--bottom my-assignments__empty">
        Nothing is assigned to you right now.
      </p>
    );
  }

  const totalSections = entries.reduce((sum, e) => sum + e.sections.length, 0);

  return (
    <div className="my-assignments">
      <p className="u-text--muted p-text--small my-assignments__summary">
        {entries.length} {entries.length === 1 ? "project" : "projects"}
        {totalSections > 0 &&
          `, ${totalSections} ${totalSections === 1 ? "section" : "sections"} to answer`}
      </p>

      <ul className="p-list--divided u-no-margin--bottom">
        {entries.map((entry) => (
          <li key={entry.projectId} className="p-list__item my-assignments__row">
            <div className="my-assignments__head">
              <button
                type="button"
                onClick={() => onOpenProject(entry.projectId)}
                className="p-button--link u-no-margin--bottom my-assignments__link"
              >
                {entry.filename}
              </button>
              {entry.isOwner && (
                <span className="section-header__block section-header__block--band-approved">
                  Project owner
                </span>
              )}
            </div>

            <div className="my-assignments__detail">
              {entry.sections.length > 0 && (
                <span className="section-header__block">
                  {entry.sections.length === 1 ? "Section" : "Sections"}{" "}
                  {entry.sections.join(", ")}
                </span>
              )}
              {/* Owning the project without owning a section in it is a real state, not an empty
                  one — a lead is listed here so the project is reachable from their own list. */}
              {entry.sections.length === 0 && (
                <span className="u-text--muted p-text--small">
                  No sections assigned to you in this project.
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
