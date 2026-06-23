"use client";

import type { RfpRecord } from "@/lib/types";

interface Props {
  record: RfpRecord;
}

export default function RfpResultCard({ record }: Props) {
  return (
    <div className="p-card rfp-result-card">
      <h4 className="p-card__title rfp-result-card__question">
        {record.question}
      </h4>
      <p className="rfp-result-card__answer">{record.answer}</p>
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
