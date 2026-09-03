"use client";

import { useState } from "react";
import { STATUS_BANDS } from "@/lib/projects";
import type { ProjectStats } from "@/lib/types";

interface Props {
  stats: ProjectStats;
  /** Outer diameter in pixels. */
  size?: number;
}

/** Ring thickness, and the clear space between one ring and the next. */
const RING_WIDTH = 6;
const RING_GAP = 4;

/**
 * A Landscape-style concentric progress wheel.
 *
 * Vanilla has no meter or progress pattern, so this is a hand-rolled SVG. Each status gets its **own
 * complete ring**, nested inside the one before it — approved outermost, then ready for review, then
 * unanswered at the centre. A ring is not a slice of a shared circle: it shows that status's share of
 * the project as a fraction of its own full circumference, so every ring starts at twelve o'clock and
 * three half-filled rings mean three statuses each holding half the questions.
 *
 * That is the difference from a segmented donut, where the bands divide one circle between them and
 * only the first can start at the top. Reading three independent proportions at a glance is what this
 * shape is for.
 *
 * Mechanically: one `<circle>` per ring carrying a two-value `stroke-dasharray` — the filled arc's
 * length, then the rest of the circumference as a gap. The group is rotated -90° so every arc begins at
 * twelve o'clock rather than three. Each ring also gets a full-circumference track beneath it, which is
 * what makes a partly-filled ring legible and what carries the hover target: the track is always there,
 * so a status sitting at 0% can still be pointed at and read.
 *
 * Colours come from Vanilla's semantic border variables via a modifier class, so the wheel follows the
 * `is-dark` theme and matches the badges for the same statuses.
 */
export default function ProgressWheel({ stats, size = 132 }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);

  const center = size / 2;
  const total = stats.itemCount;

  // Outermost ring first, so index 0 is the widest radius. `STATUS_BANDS` is already in that order:
  // approved, ready, unanswered.
  const rings = STATUS_BANDS.map((band, index) => {
    const radius = (size - RING_WIDTH) / 2 - index * (RING_WIDTH + RING_GAP);
    const circumference = 2 * Math.PI * radius;
    const count = stats[band.key];
    const fraction = total > 0 ? count / total : 0;
    return {
      ...band,
      radius,
      circumference,
      count,
      fraction,
      length: fraction * circumference,
    };
  });

  // The innermost ring's inner edge, so the centre readout sits in clear space rather than over a ring.
  const innermost = rings[rings.length - 1];
  const readoutSize = Math.max(0, (innermost.radius - RING_WIDTH) * 2);

  const active = hovered ? rings.find((r) => r.modifier === hovered) : null;
  const percent = (fraction: number) => Math.round(fraction * 100);

  return (
    <div className="progress-wheel" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={
          total === 0
            ? "No questions"
            : rings
                .map((r) => `${r.count} ${r.label} (${percent(r.fraction)}%)`)
                .join(", ")
        }
      >
        <g transform={`rotate(-90 ${center} ${center})`}>
          {rings.map((ring) => (
            <g key={ring.modifier}>
              <circle
                className={`progress-wheel__track progress-wheel__track--${ring.modifier}`}
                cx={center}
                cy={center}
                r={ring.radius}
                fill="none"
                strokeWidth={RING_WIDTH}
                onMouseEnter={() => setHovered(ring.modifier)}
                onMouseLeave={() => setHovered(null)}
              />
              {ring.length > 0 && (
                <circle
                  className={`progress-wheel__band progress-wheel__band--${ring.modifier}${
                    hovered === ring.modifier ? " is-hovered" : ""
                  }`}
                  cx={center}
                  cy={center}
                  r={ring.radius}
                  fill="none"
                  strokeWidth={RING_WIDTH}
                  strokeDasharray={`${ring.length} ${ring.circumference - ring.length}`}
                />
              )}
            </g>
          ))}
        </g>
      </svg>

      {/* Centre readout. The hovered ring's exact figure, and the approved share otherwise. */}
      <div
        className="progress-wheel__center"
        style={{ width: readoutSize, height: readoutSize }}
        aria-hidden
      >
        {active ? (
          <>
            <span className="progress-wheel__value">{percent(active.fraction)}%</span>
            <span className="progress-wheel__label">{active.short}</span>
          </>
        ) : (
          <>
            <span className="progress-wheel__value">{percent(stats.approvedFraction)}%</span>
            <span className="progress-wheel__label">Approved</span>
          </>
        )}
      </div>

      {/* Exact count, since a percentage alone hides how much work a ring represents. */}
      {active && (
        <div className="progress-wheel__tooltip" role="tooltip">
          {active.count} of {total} {active.label.toLowerCase()}
        </div>
      )}
    </div>
  );
}
