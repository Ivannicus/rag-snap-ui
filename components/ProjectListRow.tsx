"use client";

import TeamMemberMultiSelect from "./TeamMemberMultiSelect";
import { STATUS_BANDS, isOverdue, ownerIdsOf } from "@/lib/projects";
import type { ProjectStats, ProjectSummary, TeamMember } from "@/lib/types";

interface Props {
  project: ProjectSummary;
  teamMembers: TeamMember[];
  /** True while this project's document is being fetched for opening. */
  opening: boolean;
  selected: boolean;
  onToggleSelected: (projectId: string) => void;
  onOpen: (projectId: string) => void;
  onChangeOwners: (projectId: string, memberIds: string[]) => void;
}

/**
 * The approved share as a single bar.
 *
 * The list view's answer to `ProgressWheel`: one metric instead of three, because a row is scanned
 * against the rows above and below it and a bar's filled length compares across rows at a glance in a
 * way three concentric arcs do not. The other two bands are still on the row as counts — the bar is a
 * comparison, the badges are the detail.
 *
 * Coloured from the same `--vf-color-border-positive` the wheel's approved ring uses, so the two views
 * cannot disagree about what approved looks like.
 */
function ApprovedBar({ stats }: { stats: ProjectStats }) {
  const percent = Math.round(stats.approvedFraction * 100);
  return (
    <div className="approved-bar">
      <div
        className="approved-bar__track"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Approved"
        title={`${stats.approved} of ${stats.itemCount} approved`}
      >
        {/* Rendered even at 0% — a zero-width fill is invisible, and the track alone is what says the
            bar is a scale rather than missing data. */}
        <div className="approved-bar__fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="approved-bar__value p-text--small">{percent}%</span>
    </div>
  );
}

/**
 * One project as a single line, for the dashboard's list view.
 *
 * Deliberately not a slimmed-down `ProjectCard`: it carries a different, smaller set of fields — name,
 * approved bar, the three status counts, owners — so that thirty projects can be read down a column.
 * Due date, uploader and export stamp are the card's to show; a row that carried everything would be
 * a card again, only narrower.
 *
 * The grid template lives on `.project-list__row` rather than on the container, so every row lays out
 * against the same columns and the values line up down the page. That is the whole point of the view,
 * and it is why the columns are fixed widths rather than `auto`.
 */
export default function ProjectListRow({
  project,
  teamMembers,
  opening,
  selected,
  onToggleSelected,
  onOpen,
  onChangeOwners,
}: Props) {
  const { meta, overlays, stats } = project;
  const overdue = isOverdue(meta, stats);
  const ownerIds = ownerIdsOf(overlays);

  return (
    <div
      className={`project-list__row${selected ? " is-selected" : ""}${
        overdue ? " project-list__row--overdue" : ""
      }`}
    >
      {/* Same separate-control reasoning as the card: selecting several projects to bulk-assign must
          never open one by accident. */}
      <label className="project-list__select p-checkbox u-no-margin--bottom">
        <input
          type="checkbox"
          className="p-checkbox__input"
          checked={selected}
          onChange={() => onToggleSelected(meta.id)}
          aria-label={`Select ${meta.filename}`}
        />
        <span className="p-checkbox__label"></span>
      </label>

      {/* The name is the open target — there is no room for a separate Open button on one line, and a
          filename that opens its project is the convention a list sets up anyway. */}
      <button
        type="button"
        onClick={() => onOpen(meta.id)}
        disabled={opening}
        className="project-list__filename"
        title={`Open ${meta.filename}`}
      >
        {opening && <i className="p-icon--spinner u-animation--spin" aria-hidden></i>}
        <span className="project-list__filename-text">{meta.filename}</span>
      </button>

      <ApprovedBar stats={stats} />

      {/* One cell per band, in `STATUS_BANDS` order, matching the three badge tracks in
          `.project-list__row`. The wrapper is rendered even at zero so the cell survives: dropping the
          element instead would let the next band's badge slide left out from under its heading, and the
          alignment down the page is the only reason this view exists. */}
      {STATUS_BANDS.map((band) => (
        <div key={band.key} className="project-list__badge">
          {stats[band.key] > 0 && (
            <span
              className={`section-header__block section-header__block--band-${band.modifier}`}
            >
              {/* The count is boxed to three digits wide (see `.project-list__badge-count`) so every
                  badge in a band draws at one width whatever the number. There is deliberately no
                  space between the two spans: `.section-header__block` is an inline *flex* container,
                  where a whitespace-only run between items is dropped, so the gap has to be a margin
                  on the count rather than a text node. */}
              <span className="project-list__badge-count">{stats[band.key]}</span>
              <span>{band.short}</span>
            </span>
          )}
        </div>
      ))}

      <TeamMemberMultiSelect
        label=""
        value={ownerIds}
        teamMembers={teamMembers}
        onChange={(ids) => onChangeOwners(meta.id, ids)}
        emptyLabel="Assign"
        srName={`Team for ${meta.filename}`}
        compact
      />
    </div>
  );
}
