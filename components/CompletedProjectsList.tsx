"use client";

import { useMemo, useState } from "react";
import { getArchivedPayload } from "@/lib/archive";
import { buildCsv, csvFilenameFor, downloadCsv } from "@/lib/csv";
import { formatTimestamp } from "@/lib/utils";
import type { ArchivedProjectMeta, DealStatus } from "@/lib/types";

/**
 * What the section is filtered to.
 *
 * Two different axes in one control, which is deliberate: a reader looking through finished work asks
 * which of these is still open for revision and which of these was won in the same breath, and a second
 * dropdown for two or three options each would be more chrome than the list itself. The `<optgroup>`s —
 * "Record status" and "Deal outcome" — are what keep the two legible as separate questions.
 */
type CompletedFilter = "all" | "reopen" | "csv" | DealStatus;

/** The dropdown on each row. Order is worst-to-best deliberately left alone — see `DEAL_LABELS`. */
const DEAL_OPTIONS: ReadonlyArray<{ value: DealStatus; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

/**
 * Status to badge tint, from the four the app allows.
 *
 * `positive` for won, `negative` for lost, `caution` for pending — the same three the question cards
 * and section badges use for approved, unanswered and edited, so a colour means one thing across the
 * app. `information` (blue) is deliberately unused here: it reads as "in progress", and a completed
 * project's deal is not a progress bar.
 */
const DEAL_TINT: Record<DealStatus, string> = {
  won: "positive",
  lost: "negative",
  pending: "caution",
};

interface Props {
  archived: ArchivedProjectMeta[];
  loading: boolean;
  /** Ids of `savedFiles` records that still exist, so a row can offer to reopen rather than download. */
  liveProjectIds: Set<string>;
  onOpenProject: (projectId: string) => void;
  /** Report a deal outcome. Owned by the dashboard, which holds the archive list this reads. */
  onChangeDealStatus: (archiveId: string, status: DealStatus) => void;
  onError: (title: string, message: string) => void;
}

/**
 * Completed projects, one line each, below the active grid.
 *
 * Enumerates the archive rather than `/sessions`, which accumulates a node per document ever opened and
 * never sheds one — listing that would show every abandoned and deleted project as though it were
 * finished.
 *
 * A row does one of two things depending on whether the project still exists in the shared list:
 * reopen it for more work, or regenerate its CSV from the archived document. The CSV is rebuilt on
 * demand through the same `buildCsv` the original export used, rather than stored as a blob — a stored
 * blob is a second copy to keep, and it would freeze the column layout at whatever it was on the day
 * of the export.
 *
 * Each row also carries the deal's outcome, which is the one thing here a reader can still change.
 * It is a `<select>` rather than a badge because reporting it is the point — a badge would need a
 * second control beside it to do the same job.
 */
export default function CompletedProjectsList({
  archived,
  loading,
  liveProjectIds,
  onOpenProject,
  onChangeDealStatus,
  onError,
}: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<CompletedFilter>("all");

  const visible = useMemo(() => {
    switch (filter) {
      case "all":
        return archived;
      // The availability pair reads `liveProjectIds`, not the archive entry: whether a finished project
      // can be opened again depends on whether its `savedFiles` record still exists, which
      // export-and-remove decides *after* the entry is written. Nothing on the entry could know.
      case "reopen":
        return archived.filter((e) => liveProjectIds.has(e.sourceSessionId));
      case "csv":
        return archived.filter((e) => !liveProjectIds.has(e.sourceSessionId));
      default:
        return archived.filter((e) => e.dealStatus === filter);
    }
  }, [archived, filter, liveProjectIds]);

  async function handleDownload(entry: ArchivedProjectMeta) {
    setBusyId(entry.id);
    try {
      const payload = await getArchivedPayload(entry.id);
      if (!payload) {
        onError(
          "Nothing archived to download",
          `The results for "${entry.filename}" are not in the archive, so the CSV cannot be rebuilt. Whoever exported it will still have their downloaded copy.`
        );
        return;
      }
      const csv = buildCsv(payload.data, { editedAnswers: payload.editedAnswers });
      if (!downloadCsv(csv, csvFilenameFor(entry.filename))) {
        onError(
          "Download failed",
          "The CSV could not be created, so nothing was downloaded. Try again."
        );
      }
    } catch {
      onError(
        "Could not reach the archive",
        "The archived results could not be loaded. Check your connection, then try again."
      );
    } finally {
      setBusyId(null);
    }
  }

  /**
   * The heading, identical in all four states below.
   *
   * The count is of what is on screen against what there is, so a filter that hides everything still
   * says how much it is hiding — "0 of 12" rather than an empty section that looks broken.
   */
  const heading = (
    <div className="completed-list__head">
      <h3 className="p-heading--5 completed-list__heading">
        Completed &amp; Exported
        {archived.length > 0 && (
          <span className="u-text--muted p-text--small completed-list__count">
            {visible.length === archived.length
              ? archived.length
              : `${visible.length} of ${archived.length}`}
          </span>
        )}
      </h3>

      {archived.length > 0 && (
        <label className="completed-list__filter">
          <span className="u-text--muted p-text--small">Show</span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as CompletedFilter)}
            className="u-no-margin--bottom"
          >
            <option value="all">All records</option>
            {/* "Record status", not "Availability" or "Status": the dashboard above already has a Status
                filter over active projects, and two controls on one screen labelled the same thing
                filtering different populations is worse than a slightly longer word. */}
            <optgroup label="Record status">
              <option value="reopen">Open for revision</option>
              <option value="csv">Archived — export only</option>
            </optgroup>
            <optgroup label="Deal outcome">
              {DEAL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      )}
    </div>
  );

  if (loading) {
    return (
      <section className="completed-list">
        {heading}
        <p className="u-text--muted p-text--small u-no-margin--bottom">
          <i className="p-icon--spinner u-animation--spin" aria-hidden></i> Loading archive…
        </p>
      </section>
    );
  }

  if (archived.length === 0) {
    return (
      <section className="completed-list">
        {heading}
        <p className="u-text--muted p-text--small u-no-margin--bottom">
          Nothing has been exported yet. Exporting a project&rsquo;s CSV archives it here.
        </p>
      </section>
    );
  }

  return (
    <section className="completed-list">
      {heading}

      {visible.length === 0 ? (
        <p className="u-text--muted p-text--small u-no-margin--bottom">
          No completed projects match that filter.
        </p>
      ) : (
        <ul className="p-list--divided u-no-margin--bottom">
          {visible.map((entry) => {
            const stillLive = liveProjectIds.has(entry.sourceSessionId);
            const busy = busyId === entry.id;
            return (
              <li key={entry.id} className="p-list__item completed-row">
                <i className="p-icon--archive completed-row__icon" aria-hidden></i>
                <span className="completed-row__name" title={entry.filename}>
                  {entry.filename}
                </span>
                <span className="completed-row__cell u-text--muted p-text--small">
                  {/* The count is padded to three digits by `.completed-row__count`, so the word after
                      it starts at the same x on every row. The gap is a margin on the count, not a
                      space here — see the rule. */}
                  <span className="completed-row__count">{entry.itemCount}</span>
                  {entry.itemCount === 1 ? "question" : "questions"}
                </span>
                {/* Hidden by the stylesheet below the width that fits it, rather than dropped from the
                    markup at a JS breakpoint — the row is a grid whose template changes with it. */}
                <span
                  className="completed-row__cell completed-row__by u-text--muted p-text--small"
                  title={entry.exportedBy}
                >
                  {entry.exportedBy}
                </span>
                <span className="completed-row__cell completed-row__date u-text--muted p-text--small">
                  {formatTimestamp(entry.exportedAt)}
                </span>

                <select
                  value={entry.dealStatus}
                  onChange={(e) => onChangeDealStatus(entry.id, e.target.value as DealStatus)}
                  aria-label={`Deal status for ${entry.filename}`}
                  className={`completed-row__status completed-row__status--${
                    DEAL_TINT[entry.dealStatus]
                  }`}
                >
                  {DEAL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>

                {stillLive ? (
                  <button
                    type="button"
                    onClick={() => onOpenProject(entry.sourceSessionId)}
                    className="p-button--base is-dense u-no-margin--bottom completed-row__action"
                  >
                    Open project
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleDownload(entry)}
                    disabled={busy}
                    className="p-button--base is-dense u-no-margin--bottom completed-row__action"
                    title="Rebuild the CSV from the archived results"
                  >
                    {busy ? (
                      <>
                        <i className="p-icon--spinner u-animation--spin" aria-hidden></i> Building…
                      </>
                    ) : (
                      <>
                        <i className="p-icon--begin-downloading" aria-hidden></i> Download CSV
                      </>
                    )}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
