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
        </div>
      </div>

      {/* Every badge always renders, in one fixed slot each, so no card is taller than another because of
          which counts happen to be nonzero. A count at zero keeps its box and says 0 but drops its tint
          and fades, as the section headers in the Collab UI do. The grid spans the whole card rather
          than the column beside the wheel, which is too narrow for two tiles at the grid's minimum card
          width — and the bands use their short labels so two fit across it. No Edited badge: edits are
          already counted inside the three bands. */}
      <div className="project-card__badges">
        <span
          className={`section-header__block project-card__badge${
            stats.itemCount > 0 ? "" : " section-header__block--zero"
          }`}
        >
          <span className="project-card__badge-count">{stats.itemCount}</span>
          {stats.itemCount === 1 ? "Question" : "Questions"}
        </span>
        {STATUS_BANDS.map((band) => (
          <span
            key={band.key}
            title={band.label}
            className={`section-header__block project-card__badge ${
              stats[band.key] > 0
                ? `section-header__block--band-${band.modifier}`
                : "section-header__block--zero"
            }`}
          >
            <span className="project-card__badge-count">{stats[band.key]}</span>
            {band.short}
          </span>
        ))}
      </div>

      <div className="project-card__actions">
        <button
          type="button"
          onClick={() => onOpen(meta.id)}
          disabled={opening}
          // `--positive`, Vanilla's green, rather than the brand orange: opening a project is the
          // card's one affirmative action. The spinner keeps `is-light` either way — both fills are
          // dark enough to need the white icon.
          className="p-button--positive is-dense u-no-margin--bottom"
        >
          {opening ? (
            <>
              <i className="p-icon--spinner u-animation--spin is-light" aria-hidden></i> Opening…
            </>
          ) : (
            "Open project"
          )}
        </button>

        {/* Export provenance, on hover or focus. Always rendered, so it sits in the same place on every
            card; faded when there is nothing to report yet. */}
        <span
          className={`p-tooltip--top-center project-card__export-info${
            meta.exportedAt === null ? " is-empty" : ""
          }`}
          tabIndex={0}
          aria-describedby={`export-info-${meta.id}`}
        >
          <i className="p-icon--export" aria-hidden></i>
          <span className="p-tooltip__message" role="tooltip" id={`export-info-${meta.id}`}>
            {meta.exportedAt === null
              ? "Not yet exported"
              : `Exported ${formatTimestamp(meta.exportedAt)}${
                  meta.exportedBy ? `\nby ${meta.exportedBy}` : ""
                }`}
          </span>
        </span>
      </div>
    </div>
  );
}
