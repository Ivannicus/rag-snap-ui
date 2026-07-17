"use client";

import RfpResultCard from "./RfpResultCard";
import type { RfpRecord } from "@/lib/types";

interface Props {
  records: RfpRecord[];
  loading: boolean;
  totalCount: number;
  hasQuery: boolean;
  searchTerms: string[];
}

export default function RfpResultsList({ records, loading, totalCount, hasQuery, searchTerms }: Props) {
  if (loading) {
    return (
      <div className="empty-state">
        <p className="p-heading--4">Loading RFP database…</p>
      </div>
    );
  }

  if (totalCount === 0) {
    return (
      <div className="empty-state">
        <p className="p-heading--4">Database is empty</p>
        <p className="u-text--muted">
          Import data using the import script to get started.
        </p>
      </div>
    );
  }

  if (!hasQuery) {
    return (
      <div className="empty-state">
        <p className="p-heading--4">Search the RFP database</p>
        <p className="u-text--muted">
          Type keywords or select a date to find matching Q&amp;A pairs.
          {" "}{totalCount} records available.
        </p>
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="empty-state">
        <p className="p-heading--4">No results found</p>
        <p className="u-text--muted">
          Try different keywords or clear the date filter.
        </p>
      </div>
    );
  }

  return (
    <div className="rfp-results-list">
      <p className="u-text--muted p-text--small u-no-margin--bottom">
        {records.length} result{records.length !== 1 ? "s" : ""}
      </p>
      <div className="rfp-results-list__cards">
        {records.map((r) => (
          <RfpResultCard key={r.id} record={r} searchTerms={searchTerms} />
        ))}
      </div>
    </div>
  );
}
