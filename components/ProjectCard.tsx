"use client";

import ProgressWheel from "./ProgressWheel";
import DueDateField from "./DueDateField";
import TeamMemberMultiSelect from "./TeamMemberMultiSelect";
import { STATUS_BANDS, isOverdue, ownerIdsOf } from "@/lib/projects";
import { formatTimestamp } from "@/lib/utils";
import type { ProjectSummary, TeamMember } from "@/lib/types";

interface Props {
  project: ProjectSummary;
  teamMembers: TeamMember[];
  /** True while this project's document is being fetched for opening. */
  opening: boolean;
  selected: boolean;
  onToggleSelected: (projectId: string) => void;
  onOpen: (projectId: string) => void;
  onChangeOwners: (projectId: string, memberIds: string[]) => void;
  onChangeDueDate: (projectId: string, isoDate: string | null) => void;
}

/** Green once everything is approved, amber while work is outstanding, red when overdue. */
function statusModifier(complete: boolean, overdue: boolean): string {
  if (complete) return "positive";
  if (overdue) return "negative";
  return "caution";
}

export default function ProjectCard({
  project,
  teamMembers,
  opening,
  selected,
  onToggleSelected,
  onOpen,
  onChangeOwners,
  onChangeDueDate,
}: Props) {
  const { meta, overlays, stats } = project;
  const overdue = isOverdue(meta, stats);
  const ownerIds = ownerIdsOf(overlays);

  return (
    <div
      className={`p-card project-card${selected ? " is-selected" : ""}${
        overdue ? " project-card--overdue" : ""
      }`}
    >
      <div className="project-card__head">
        {/* Bulk-selection checkbox. Its own control rather than part of the open target, so that
            picking several projects to assign at once never opens one by accident. */}
        <label className="project-card__select p-checkbox u-no-margin--bottom">
          <input
            type="checkbox"
            className="p-checkbox__input"
            checked={selected}
            onChange={() => onToggleSelected(meta.id)}
            aria-label={`Select ${meta.filename}`}
          />
          <span className="p-checkbox__label"></span>
        </label>

        <div className="project-card__title">
          <button
            type="button"
            onClick={() => onOpen(meta.id)}
            className="project-card__filename"
            title={`Open ${meta.filename}`}
          >
            {meta.filename}
          </button>
          <span className="u-text--muted p-text--small project-card__uploader">
            Uploaded by {meta.uploadedByName} &middot; {formatTimestamp(meta.uploadedAt)}
          </span>
        </div>

        <span
          className={`section-header__block section-header__block--${statusModifier(
            stats.complete,
            overdue
          )} project-card__status`}
        >
          {stats.complete ? "All approved" : overdue ? "Overdue" : "In progress"}
        </span>
      </div>

      <div className="project-card__body">
        <ProgressWheel stats={stats} />

        <div className="project-card__facts">
          <div className="project-card__badges">
            <span className="section-header__block">
              {stats.itemCount} {stats.itemCount === 1 ? "Question" : "Questions"}
            </span>
            {STATUS_BANDS.map((band) =>
              stats[band.key] > 0 ? (
                <span
                  key={band.key}
                  className={`section-header__block section-header__block--band-${band.modifier}`}
                >
                  {stats[band.key]} {band.label}
                </span>
              ) : null
            )}
            {stats.editedCount > 0 && (
              <span className="section-header__block section-header__block--caution">
                {stats.editedCount} Edited
              </span>
            )}
          </div>

          <div className="project-card__row">
            {/* No icon. "Due" has none, and an icon here pushed "Team" a further icon-width-plus-gap to
                the right, so the two labels in the same column started at different x positions. */}
            <span className="u-text--muted p-text--small project-card__row-label">Team</span>
            {/* The select's own trigger shows the owners, so there is no second avatar list out here.
                There used to be one, and because it grew with every member added it shrank the button
                beside it and shifted the row each time the team changed. */}
            <TeamMemberMultiSelect
              label=""
              value={ownerIds}
              teamMembers={teamMembers}
              onChange={(ids) => onChangeOwners(meta.id, ids)}
              // "Assign team" does not fit the compact trigger's fixed width — the row's own "Team"
              // label already supplies that half of the phrase.
              emptyLabel="Assign"
              srName="Project team"
              compact
            />
          </div>

          <div className="project-card__row">
            <span className="u-text--muted p-text--small project-card__row-label">Due</span>
            <DueDateField
              value={meta.dueDate}
              overdue={overdue}
              onChange={(iso) => onChangeDueDate(meta.id, iso)}
            />
          </div>

          {meta.exportedAt !== null && (
            <p className="u-text--muted p-text--small u-no-margin--bottom">
              <i className="p-icon--export" aria-hidden></i> Exported{" "}
              {formatTimestamp(meta.exportedAt)}
              {meta.exportedBy ? ` by ${meta.exportedBy}` : ""}
            </p>
          )}
        </div>
      </div>

      <div className="project-card__actions">
        <button
          type="button"
          onClick={() => onOpen(meta.id)}
          disabled={opening}
          className="p-button--brand is-dense u-no-margin--bottom"
        >
          {opening ? (
            <>
              <i className="p-icon--spinner u-animation--spin is-light" aria-hidden></i> Opening…
            </>
          ) : (
            "Open project"
          )}
        </button>
      </div>
    </div>
  );
}
