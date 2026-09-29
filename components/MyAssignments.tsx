"use client";

import { assignmentsForMember } from "@/lib/projects";
import type { ProjectSummary, TeamMember } from "@/lib/types";

interface Props {
  /** The signed-in user's team-bank entry, or null if the bank does not hold them. */
  me: TeamMember | null;
  /**
   * True while `me` being null is not yet an answer — the team bank has not arrived.
   *
   * Without this a null `me` had exactly one reading, and it was the wrong one for the first moment of
   * every dashboard open: a reader who *is* in the bank was told they were not in it.
   */
  identityPending: boolean;
  /** True while any project's assignment overlays are still outstanding. See `overlaysPending`. */
  overlaysPending: boolean;
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
export default function MyAssignments({
  me,
  identityPending,
  overlaysPending,
  projects,
  onOpenProject,
}: Props) {
  // Identity first: everything below is a statement about one person, so there is nothing truthful to
  // say until it is settled which person that is.
  if (identityPending) {
    return (
      <p className="u-text--muted u-no-margin--bottom my-assignments__empty">
        <i className="p-icon--spinner u-animation--spin" aria-hidden></i> Checking what is assigned to
        you…
      </p>
    );
  }

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
    // Only a statement once the overlays it would be read from are actually in. A project waiting on
    // its overlays looks exactly like one nobody is assigned to, so saying "nothing" early is not a
    // slower version of the right answer — it is the wrong one.
    return overlaysPending ? (
      <p className="u-text--muted u-no-margin--bottom my-assignments__empty">
        <i className="p-icon--spinner u-animation--spin" aria-hidden></i> Checking what is assigned to
        you…
      </p>
    ) : (
      <p className="u-text--muted u-no-margin--bottom my-assignments__empty">
        Nothing is assigned to you right now.
      </p>
    );
  }

  const totalSections = entries.reduce((sum, e) => sum + e.sections.length, 0);

  return (
    <div className="my-assignments">
      {/* Named, not just "yours". Two people can have this dashboard open side by side and the lists
          differ, so saying whose it is makes a wrong identity visible instead of plausible. */}
      <p className="u-text--muted p-text--small my-assignments__summary">
        {me.name} — {entries.length} {entries.length === 1 ? "project" : "projects"}
        {totalSections > 0 &&
          `, ${totalSections} ${totalSections === 1 ? "section" : "sections"} to answer`}
        {overlaysPending && " (still loading)"}
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
