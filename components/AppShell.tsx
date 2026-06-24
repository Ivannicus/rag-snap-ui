"use client";

import { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import Header from "@/components/Header";
import type { ActiveView } from "@/components/Header";
import RfpDatabaseView from "@/components/RfpDatabaseView";
import FilterBar from "@/components/FilterBar";
import SectionGroup from "@/components/SectionGroup";
import ExportButton from "@/components/ExportButton";
import ShareButton from "@/components/ShareButton";
import { groupBySection, getSections, isUnanswered } from "@/lib/utils";
import {
  subscribeToSession,
  updateAnswer,
  clearAnswer,
  updateRating,
  clearRating,
  updateContextUrl,
  clearContextUrl,
  updateAssignee,
  clearAssignee,
  updateReviewer,
  clearReviewer,
} from "@/lib/session";
import { subscribeToTeamMembers } from "@/lib/teamBank";
import type { ParsedQAFile, Filters, QAItem, SessionState, TeamMember, PersonFilterOption } from "@/lib/types";

const DEFAULT_FILTERS: Filters = { status: "all", section: "", search: "" };

interface Props {
  initialState?: SessionState;
  userEmail?: string;
  onSignOut?: () => void;
}

export default function AppShell({ initialState, userEmail, onSignOut }: Props) {
  const [data, setData] = useState<ParsedQAFile | null>(() => initialState?.data ?? null);
  const [filename, setFilename] = useState<string | null>(() => initialState?.filename ?? null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [darkMode, setDarkMode] = useState(false);
  const [editedAnswers, setEditedAnswers] = useState<Record<string, string>>(
    () => initialState?.editedAnswers ?? {}
  );
  const [ratings, setRatings] = useState<Record<string, number>>(
    () => initialState?.ratings ?? {}
  );
  const [contextUrls, setContextUrls] = useState<Record<string, string>>(
    () => initialState?.contextUrls ?? {}
  );
  const [assignees, setAssignees] = useState<Record<string, string>>(
    () => initialState?.assignees ?? {}
  );
  const [reviewers, setReviewers] = useState<Record<string, string>>(
    () => initialState?.reviewers ?? {}
  );
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>("inspector");
  const [hasVisitedDatabase, setHasVisitedDatabase] = useState(false);

  // Suppress own-write echo: track whether incoming RTDB update was triggered by us
  const suppressNextUpdate = useRef(false);

  // Per-view scroll position, restored when switching back
  const scrollPositions = useRef<Record<ActiveView, number>>({ inspector: 0, database: 0 });

  function handleChangeView(view: ActiveView) {
    scrollPositions.current[activeView] = window.scrollY;
    setActiveView(view);
  }

  // Mount the RFP Database view on first visit, then keep it mounted (never unmount again)
  useEffect(() => {
    if (activeView === "database") setHasVisitedDatabase(true);
  }, [activeView]);

  // Restore the new view's scroll position after the DOM updates, before paint
  useLayoutEffect(() => {
    window.scrollTo(0, scrollPositions.current[activeView]);
  }, [activeView]);

  // Sync Vanilla dark theme class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add("is-dark");
    else root.classList.remove("is-dark");
  }, [darkMode]);

  // Load persisted dark mode preference
  useEffect(() => {
    const stored = localStorage.getItem("darkMode");
    if (stored === "true") setDarkMode(true);
  }, []);

  // Subscribe to the global team member bank
  useEffect(() => {
    return subscribeToTeamMembers(setTeamMembers);
  }, []);

  // Join session from URL param on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("session");
    if (!sid) return;

    setSessionId(sid);

    const unsubscribe = subscribeToSession(sid, (state) => {
      if (suppressNextUpdate.current) {
        suppressNextUpdate.current = false;
        return;
      }
      setData(state.data);
      setFilename(state.filename);
      setEditedAnswers(state.editedAnswers);
      setRatings(state.ratings);
      setContextUrls(state.contextUrls);
      setAssignees(state.assignees);
      setReviewers(state.reviewers);
    });

    return unsubscribe;
  }, []);

  function toggleDark() {
    setDarkMode((d) => {
      localStorage.setItem("darkMode", String(!d));
      return !d;
    });
  }

  const handleLoad = useCallback((loaded: ParsedQAFile, name: string) => {
    setData(loaded);
    setFilename(name);
    setFilters(DEFAULT_FILTERS);
    setEditedAnswers({});
    setRatings({});
    setContextUrls({});
    setAssignees({});
    setReviewers({});
  }, []);

  const handleSaveRating = useCallback((id: string, rating: number) => {
    setRatings((prev) => ({ ...prev, [id]: rating }));
    if (sessionId) {
      suppressNextUpdate.current = true;
      updateRating(sessionId, id, rating);
    }
  }, [sessionId]);

  const handleClearRating = useCallback((id: string) => {
    setRatings((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (sessionId) {
      suppressNextUpdate.current = true;
      clearRating(sessionId, id);
    }
  }, [sessionId]);

  const handleSaveEdit = useCallback((id: string, answer: string) => {
    setEditedAnswers((prev) => ({ ...prev, [id]: answer }));
    if (sessionId) {
      suppressNextUpdate.current = true;
      updateAnswer(sessionId, id, answer);
    }
  }, [sessionId]);

  const handleClearEdit = useCallback((id: string) => {
    setEditedAnswers((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (sessionId) {
      suppressNextUpdate.current = true;
      clearAnswer(sessionId, id);
    }
  }, [sessionId]);

  const handleSaveContextUrl = useCallback((id: string, url: string) => {
    setContextUrls((prev) => ({ ...prev, [id]: url }));
    if (sessionId) {
      suppressNextUpdate.current = true;
      updateContextUrl(sessionId, id, url);
    }
  }, [sessionId]);

  const handleClearContextUrl = useCallback((id: string) => {
    setContextUrls((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (sessionId) {
      suppressNextUpdate.current = true;
      clearContextUrl(sessionId, id);
    }
  }, [sessionId]);

  const handleSaveAssignee = useCallback((id: string, memberId: string) => {
    setAssignees((prev) => ({ ...prev, [id]: memberId }));
    if (sessionId) {
      suppressNextUpdate.current = true;
      updateAssignee(sessionId, id, memberId);
    }
  }, [sessionId]);

  const handleClearAssignee = useCallback((id: string) => {
    setAssignees((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (sessionId) {
      suppressNextUpdate.current = true;
      clearAssignee(sessionId, id);
    }
  }, [sessionId]);

  const handleSaveReviewer = useCallback((id: string, memberId: string) => {
    setReviewers((prev) => ({ ...prev, [id]: memberId }));
    if (sessionId) {
      suppressNextUpdate.current = true;
      updateReviewer(sessionId, id, memberId);
    }
  }, [sessionId]);

  const handleClearReviewer = useCallback((id: string) => {
    setReviewers((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (sessionId) {
      suppressNextUpdate.current = true;
      clearReviewer(sessionId, id);
    }
  }, [sessionId]);

  const unansweredCount = useMemo(
    () =>
      data
        ? data.items.filter(
            (i) => isUnanswered(i.answer) && !editedAnswers[i.id]
          ).length
        : 0,
    [data, editedAnswers]
  );

  const allSections = useMemo(
    () => (data ? getSections(data.items) : []),
    [data]
  );

  // Per-person filter options, computed dynamically from who actually has
  // assignments/reviews in the currently loaded file (not the full team bank).
  const personFilterOptions = useMemo((): PersonFilterOption[] => {
    if (!data) return [];

    function distinctMemberIds(roleMap: Record<string, string>): Set<string> {
      const ids = new Set<string>();
      for (const item of data!.items) {
        const id = roleMap[item.id];
        if (id) ids.add(id);
      }
      return ids;
    }

    function toOptions(
      ids: Set<string>,
      prefix: string,
      suffix: string
    ): PersonFilterOption[] {
      return Array.from(ids)
        .map((id) => teamMembers.find((m) => m.id === id))
        .filter((m): m is TeamMember => m !== undefined)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((m) => ({ value: `${prefix}:${m.id}`, label: `${m.name}'s ${suffix}` }));
    }

    return [
      ...toOptions(distinctMemberIds(assignees), "assignee", "Assignments"),
      ...toOptions(distinctMemberIds(reviewers), "reviewer", "Reviews"),
    ];
  }, [data, assignees, reviewers, teamMembers]);

  // If the active person-filter's option disappears (e.g. their last assignment
  // was cleared), fall back to "All sections" rather than silently showing nothing.
  useEffect(() => {
    const { section } = filters;
    if (!section.startsWith("assignee:") && !section.startsWith("reviewer:")) return;
    const stillValid = personFilterOptions.some((opt) => opt.value === section);
    if (!stillValid) {
      setFilters((prev) => ({ ...prev, section: "" }));
    }
  }, [personFilterOptions, filters.section]);

  const filteredItems = useMemo((): QAItem[] => {
    if (!data) return [];
    const { status, section, search } = filters;
    const term = search.toLowerCase();

    let matchingSections: Set<string> | null = null;
    if (section.startsWith("assignee:") || section.startsWith("reviewer:")) {
      const [kind, memberId] = section.split(":", 2);
      const roleMap = kind === "assignee" ? assignees : reviewers;
      matchingSections = new Set(
        data.items
          .filter((i) => roleMap[i.id] === memberId)
          .map((i) => i.id.split(".")[0])
      );
    }

    return data.items.filter((item) => {
      const effectiveAnswer = editedAnswers[item.id] ?? item.answer;
      const effectivelyUnanswered =
        isUnanswered(item.answer) && !editedAnswers[item.id];
      if (status === "answered" && effectivelyUnanswered) return false;
      if (status === "unanswered" && !effectivelyUnanswered) return false;
      if (matchingSections) {
        if (!matchingSections.has(item.id.split(".")[0])) return false;
      } else if (section && item.id.split(".")[0] !== section) {
        return false;
      }
      if (term) {
        const inQ = item.question.toLowerCase().includes(term);
        const inA = effectiveAnswer.toLowerCase().includes(term);
        if (!inQ && !inA) return false;
      }
      return true;
    });
  }, [data, filters, editedAnswers, assignees, reviewers]);

  const grouped = useMemo(() => groupBySection(filteredItems), [filteredItems]);

  const editCount = Object.keys(editedAnswers).length;
  const contextUrlCount = Object.keys(contextUrls).length;

  const currentSessionState: SessionState | null = data
    ? { data, filename: filename ?? "", editedAnswers, ratings, contextUrls, assignees, reviewers }
    : null;

  return (
    <div className="app-shell">
      <Header
        data={data}
        filename={filename}
        unansweredCount={unansweredCount}
        totalCount={data?.items.length ?? 0}
        onLoad={handleLoad}
        darkMode={darkMode}
        onToggleDark={toggleDark}
        teamMembers={teamMembers}
        activeView={activeView}
        onChangeView={handleChangeView}
      />

      {/* User bar */}
      {userEmail && (
        <div className="user-bar">
          <span className="u-text--muted p-text--small u-no-margin--bottom">{userEmail}</span>
          <button
            onClick={onSignOut}
            className="p-button--link u-no-margin--bottom"
          >
            Sign out
          </button>
        </div>
      )}

      <div className={activeView === "database" ? "u-hide" : ""}>
          {/* Live session indicator */}
          {sessionId && (
            <div className="live-session-banner">
              <span className="live-session-banner__dot" />
              Live session — edits sync in real time
            </div>
          )}

          {data ? (
            <>
              <FilterBar
                filters={filters}
                sections={allSections}
                personFilterOptions={personFilterOptions}
                onChange={setFilters}
                resultCount={filteredItems.length}
                totalCount={data.items.length}
              />

              <main className="app-main">
                {grouped.length === 0 ? (
                  <div className="empty-state">
                    <i className="p-icon--search p-icon--xx-large u-text--muted"></i>
                    <p className="p-heading--4">No questions match your filters</p>
                    <button
                      onClick={() => setFilters(DEFAULT_FILTERS)}
                      className="p-button--link u-no-margin--bottom"
                    >
                      Clear all filters
                    </button>
                  </div>
                ) : (
                  <div className="section-groups">
                    {grouped.map(({ section, items }) => (
                      <SectionGroup
                        key={section}
                        section={section}
                        items={items}
                        searchTerm={filters.search}
                        editedAnswers={editedAnswers}
                        onSaveEdit={handleSaveEdit}
                        onClearEdit={handleClearEdit}
                        ratings={ratings}
                        onSaveRating={handleSaveRating}
                        onClearRating={handleClearRating}
                        contextUrls={contextUrls}
                        onSaveContextUrl={handleSaveContextUrl}
                        onClearContextUrl={handleClearContextUrl}
                        assignees={assignees}
                        onSaveAssignee={handleSaveAssignee}
                        onClearAssignee={handleClearAssignee}
                        reviewers={reviewers}
                        onSaveReviewer={handleSaveReviewer}
                        onClearReviewer={handleClearReviewer}
                        teamMembers={teamMembers}
                      />
                    ))}
                  </div>
                )}

                <div className="export-footer">
                  <div>
                    <p className="u-no-margin--bottom">
                      <strong>Export results</strong>
                    </p>
                    <p className="u-text--muted p-text--small">
                      CSV with question, original answer, edited answer, context URL, and rating columns.
                      {editCount > 0 && ` ${editCount} edited answer${editCount !== 1 ? "s" : ""} included.`}
                      {contextUrlCount > 0 && ` ${contextUrlCount} context URL${contextUrlCount !== 1 ? "s" : ""} included.`}
                    </p>
                  </div>
                  <div className="export-footer__actions">
                    {currentSessionState && !sessionId && (
                      <ShareButton sessionState={currentSessionState} />
                    )}
                    <ExportButton
                      data={data}
                      editedAnswers={editedAnswers}
                      ratings={ratings}
                      contextUrls={contextUrls}
                      sourceFilename={filename}
                    />
                  </div>
                </div>
              </main>
            </>
          ) : (
            <main className="app-main no-file-state">
              <i className="p-icon--file p-icon--xx-large"></i>
              <h2 className="p-heading--2">No file loaded</h2>
              <p className="u-text--muted">
                Use the file loader above to open a JSON results file and start exploring Q&amp;A pairs.
              </p>
              <div className="p-card no-file-state__example">
                <p><strong>Expected JSON format:</strong></p>
                <pre className="u-no-margin--bottom">{`{
  "generated_at": "2026-04-09T...",
  "model": "model-name",
  "results": [
    {
      "id": "1.1",
      "question": "...",
      "answer": "..."
    }
  ]
}`}</pre>
              </div>
            </main>
          )}
      </div>

      {hasVisitedDatabase && (
        <div className={activeView === "inspector" ? "u-hide" : ""}>
          <RfpDatabaseView />
        </div>
      )}
    </div>
  );
}
