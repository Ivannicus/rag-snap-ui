"use client";

import type { ProjectSummary } from "@/lib/types";
import { isOverdue } from "@/lib/projects";

interface Props {
  projects: ProjectSummary[];
  archivedCount: number;
}

/**
 * The four figures a lead wants before reading any individual card.
 *
 * Counted over every active project, not the filtered view — the strip is meant to answer "how are we
 * doing overall", and a total that shifted every time someone narrowed the list by owner would answer
 * a different question each time it was read.
 */
export default function ProjectSummaryStrip({ projects, archivedCount }: Props) {
  const total = projects.length;
  const complete = projects.filter((p) => p.stats.complete).length;
  const inProgress = total - complete;
  const overdue = projects.filter((p) => isOverdue(p.meta, p.stats)).length;

  const questionTotal = projects.reduce((sum, p) => sum + p.stats.itemCount, 0);
  const approvedTotal = projects.reduce((sum, p) => sum + p.stats.approved, 0);

  const tiles: Array<{ label: string; value: number | string; modifier?: string; hint?: string }> = [
    { label: "Active projects", value: total, hint: `${questionTotal} questions in total` },
    { label: "In progress", value: inProgress, modifier: "caution" },
    {
      label: "Fully approved",
      value: complete,
      modifier: "positive",
      hint: questionTotal > 0 ? `${approvedTotal} of ${questionTotal} questions approved` : undefined,
    },
    { label: "Overdue", value: overdue, modifier: overdue > 0 ? "negative" : undefined },
  ];

  return (
    <div className="summary-strip">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className={`summary-strip__tile${
            tile.modifier ? ` summary-strip__tile--${tile.modifier}` : ""
          }`}
        >
          <span className="summary-strip__value">{tile.value}</span>
          <span className="summary-strip__label">{tile.label}</span>
          {tile.hint && <span className="summary-strip__hint">{tile.hint}</span>}
        </div>
      ))}
      <div className="summary-strip__tile summary-strip__tile--muted">
        <span className="summary-strip__value">{archivedCount}</span>
        <span className="summary-strip__label">Completed &amp; exported</span>
      </div>
    </div>
  );
}
