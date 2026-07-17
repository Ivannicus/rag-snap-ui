"use client";

import type { ReactNode } from "react";
import type { RfpRecord } from "@/lib/types";

interface Props {
  record: RfpRecord;
  searchTerms: string[];
}

function highlightTerms(text: string, terms: string[]): ReactNode {
  if (terms.length === 0) return text;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rfp-highlight">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export default function RfpResultCard({ record, searchTerms }: Props) {
  return (
    <div className="p-card rfp-result-card">
      <h4 className="p-card__title rfp-result-card__question">
        {highlightTerms(record.question, searchTerms)}
      </h4>
      <p className="rfp-result-card__answer">
        {highlightTerms(record.answer, searchTerms)}
      </p>
      <div className="rfp-result-card__meta">
        {record.source && (
          <span className="u-text--muted p-text--small">
            Source: {record.source}
          </span>
        )}
        {record.rfpDate && (
          <span className="section-header__block">{record.rfpDate}</span>
        )}
      </div>
    </div>
  );
}
