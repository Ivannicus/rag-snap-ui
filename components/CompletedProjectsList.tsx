"use client";

import { useState } from "react";
import { getArchivedPayload } from "@/lib/archive";
import { buildCsv, csvFilenameFor, downloadCsv } from "@/lib/csv";
import { formatTimestamp } from "@/lib/utils";
import type { ArchivedProjectMeta } from "@/lib/types";

interface Props {
  archived: ArchivedProjectMeta[];
  loading: boolean;
  /** Ids of `savedFiles` records that still exist, so a row can offer to reopen rather than download. */
  liveProjectIds: Set<string>;
  onOpenProject: (projectId: string) => void;
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
 */
export default function CompletedProjectsList({
  archived,
  loading,
  liveProjectIds,
  onOpenProject,
  onError,
}: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);

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

  if (loading) {
    return (
      <section className="completed-list">
        <h3 className="p-heading--5 completed-list__heading">Completed &amp; exported</h3>
        <p className="u-text--muted p-text--small">
          <i className="p-icon--spinner u-animation--spin" aria-hidden></i> Loading archive…
        </p>
      </section>
    );
  }

  if (archived.length === 0) {
    return (
      <section className="completed-list">
        <h3 className="p-heading--5 completed-list__heading">Completed &amp; exported</h3>
        <p className="u-text--muted p-text--small u-no-margin--bottom">
          Nothing has been exported yet. Exporting a project&rsquo;s CSV archives it here.
        </p>
      </section>
    );
  }

  return (
    <section className="completed-list">
      <h3 className="p-heading--5 completed-list__heading">
        Completed &amp; exported
        <span className="u-text--muted p-text--small completed-list__count">
          {archived.length}
        </span>
      </h3>

      <ul className="p-list--divided u-no-margin--bottom">
        {archived.map((entry) => {
          const stillLive = liveProjectIds.has(entry.sourceSessionId);
          const busy = busyId === entry.id;
          return (
            <li key={entry.id} className="p-list__item completed-row">
              <i className="p-icon--archive completed-row__icon" aria-hidden></i>
              <span className="completed-row__name" title={entry.filename}>
                {entry.filename}
              </span>
              <span className="completed-row__meta u-text--muted p-text--small">
                {entry.itemCount} {entry.itemCount === 1 ? "question" : "questions"}
              </span>
              <span className="completed-row__meta u-text--muted p-text--small">
                {entry.exportedBy}
              </span>
              <span className="completed-row__meta u-text--muted p-text--small">
                {formatTimestamp(entry.exportedAt)}
              </span>
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
    </section>
  );
}
