"use client";

import { useState, useEffect, useMemo } from "react";
import RfpSearchBar from "./RfpSearchBar";
import RfpResultsList from "./RfpResultsList";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { subscribeToRfpDatabase, searchRfpRecords } from "@/lib/rfpDatabase";
import { formatDate } from "@/lib/utils";
import type { RfpRecord } from "@/lib/types";

export default function RfpDatabaseView() {
  const [records, setRecords] = useState<RfpRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let dbUnsub: (() => void) | null = null;

    const authUnsub = onAuthStateChanged(auth, (user) => {
      if (!user) return;
      dbUnsub = subscribeToRfpDatabase(
        (data) => {
          setRecords(data);
          setLoading(false);
          setError(null);
        },
        (err) => {
          console.error("RFP Database load failed:", err);
          setError(err.message);
          setLoading(false);
        }
      );
      authUnsub();
    });

    return () => {
      authUnsub();
      if (dbUnsub) dbUnsub();
    };
  }, []);

  const availableDates = useMemo(() => {
    const dates = new Set(records.map((r) => r.rfpDate).filter(Boolean));
    return Array.from(dates).sort();
  }, [records]);

  const filtered = useMemo(
    () => searchRfpRecords(records, query, dateFilter || undefined),
    [records, query, dateFilter]
  );

  const searchTerms = useMemo(
    () => query.trim().split(/\s+/).filter(Boolean),
    [query]
  );

  const lastImported = useMemo(() => {
    if (records.length === 0) return null;
    const max = Math.max(...records.map((r) => r.importedAt));
    return formatDate(new Date(max).toISOString());
  }, [records]);

  return (
    <main className="app-main">
      <div className="rfp-database-header">
        <h2 className="p-heading--4 u-no-margin--bottom">RFP Database</h2>
        {lastImported && (
          <span className="u-text--muted p-text--small">
            Last imported: {lastImported}
          </span>
        )}
      </div>

      {error && (
        <div className="p-notification--negative">
          <div className="p-notification__content">
            <p className="p-notification__message">
              Failed to load database: {error}
            </p>
          </div>
        </div>
      )}

      <RfpSearchBar
        query={query}
        onQueryChange={setQuery}
        dateFilter={dateFilter}
        onDateFilterChange={setDateFilter}
        availableDates={availableDates}
      />

      <RfpResultsList
        records={filtered}
        loading={loading}
        totalCount={records.length}
        hasQuery={query.trim().length > 0 || dateFilter.length > 0}
        searchTerms={searchTerms}
      />
    </main>
  );
}
