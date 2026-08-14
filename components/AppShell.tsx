"use client";

import { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import type { ActiveView } from "@/components/Header";
import RfpDatabaseView from "@/components/RfpDatabaseView";
import FilterBar from "@/components/FilterBar";
import SectionGroup from "@/components/SectionGroup";
import { groupBySection, getSections, isUnanswered } from "@/lib/utils";
import {
  ensureSession,
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

/**
 * Shallow value equality for the overlay maps.
 *
 * Every remote snapshot arrives as freshly built objects, so applying one unconditionally would
 * re-render every card even when nothing changed. Comparing values lets an echo of our own write
 * settle without a render.
 */
function sameMap<T>(a: Record<string, T>, b: Record<string, T>): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

/** Point the address bar at a doc without navigating, which a static export cannot do. */
function syncDocParam(id: string) {
  const url = new URL(window.location.href);
  if (url.searchParams.get("doc") === id) return;
  url.searchParams.set("doc", id);
  window.history.replaceState(null, "", url.toString());
}

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
  // A doc's session id is its saved-file id, so this doubles as session identity: opening the same
  // doc always joins the same room instead of minting a new random session.
  const [docId, setDocId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>("inspector");
  const [hasVisitedDatabase, setHasVisitedDatabase] = useState(false);
  // Set when a write to the session is rejected. Without this the UI shows the change as though it
  // saved, because local state is updated independently of the write.
  const [writeFailed, setWriteFailed] = useState(false);

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

  // Adopt the doc named in the URL on mount. Full ?doc= routing lands in a later phase; this is
  // just enough for a second tab on the same URL to join the same room.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("doc");
    if (id) setDocId(id);
  }, []);

  /**
   * Apply a remote snapshot.
   *
   * There is no echo suppression: every snapshot is applied, including the echo of our own write.
   * That is safe because RTDB reflects local writes in local snapshots before the server confirms
   * them, so an echo can never carry a value older than what we already hold, and because writes
   * are per field, so an echo for one item cannot clobber another. `sameMap` keeps the no-op echoes
   * from causing renders.
   *
   * Doc content is immutable within a session and is set by whoever opened the doc, so `data` and
   * `filename` are only adopted when we have none. That covers a tab that joined by URL with
   * nothing loaded, without letting a snapshot replace the doc under an open one.
   */
  const applyRemoteState = useCallback((state: SessionState) => {
    if (state.data) setData((prev) => prev ?? state.data);
    if (state.filename) setFilename((prev) => prev ?? state.filename);
    setEditedAnswers((prev) => (sameMap(prev, state.editedAnswers) ? prev : state.editedAnswers));
    setRatings((prev) => (sameMap(prev, state.ratings) ? prev : state.ratings));
    setContextUrls((prev) => (sameMap(prev, state.contextUrls) ? prev : state.contextUrls));
    setAssignees((prev) => (sameMap(prev, state.assignees) ? prev : state.assignees));
    setReviewers((prev) => (sameMap(prev, state.reviewers) ? prev : state.reviewers));
  }, []);

  // One listener per doc. Keying the effect on docId makes React tear the previous listener down
  // before attaching the next one, so a doc switch cannot leave the old room subscribed. The
  // `active` flag is belt and braces: even if a snapshot were already queued when the listener was
  // detached, it cannot land in the newly opened doc's state.
  useEffect(() => {
    if (!docId) return;
    let active = true;
    const unsubscribe = subscribeToSession(docId, (state) => {
      if (active) applyRemoteState(state);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [docId, applyRemoteState]);

  function toggleDark() {
    setDarkMode((d) => {
      localStorage.setItem("darkMode", String(!d));
      return !d;
    });
  }

  /**
   * Open a doc, replacing whatever was open.
   *
   * Switching docs means switching rooms, so session identity is repointed here. Setting `docId`
   * changes the subscription effect's dependency, which tears down the previous doc's listener
   * before the next one attaches, and every subsequent write is addressed to the new id. Both used
   * to leak: the maps were cleared but the id was left alone, so edits to the new doc landed in the
   * previous doc's node.
   */
  const handleLoad = useCallback((loaded: ParsedQAFile, name: string, loadedDocId: string) => {
    setData(loaded);
    setFilename(name);
    setFilters(DEFAULT_FILTERS);
    setEditedAnswers({});
    setRatings({});
    setContextUrls({});
    setAssignees({});
    setReviewers({});
    setDocId(loadedDocId);
    syncDocParam(loadedDocId);

    // Seed the room for whoever opens this doc first. Existing sessions are left untouched, and
    // their overlays arrive through the subscription a moment later.
    void ensureSession(loadedDocId, {
      data: loaded,
      filename: name,
      editedAnswers: {},
      ratings: {},
      contextUrls: {},
      assignees: {},
      reviewers: {},
    });
  }, []);

  /**
   * Address a write to the open doc's room.
   *
   * An open doc is always a session, so this is the one place that still checks: the postMessage
   * import path renders AppShell with `initialState` and no doc id, and it cannot be given one
   * without editing that receiver. Everywhere else `docId` is set and the write goes through
   * unconditionally.
   *
   * All 14 change callbacks funnel through here, which makes it the single place to notice a
   * rejected write. Local state has already been updated by the time the rejection arrives, so the
   * change stays on screen and the toast is the only signal that it may not have persisted.
   */
  const writeToSession = useCallback(
    (write: (sessionId: string) => Promise<unknown>) => {
      if (!docId) return;
      write(docId).catch(() => setWriteFailed(true));
    },
    [docId]
  );

  const handleSaveRating = useCallback((id: string, rating: number) => {
    setRatings((prev) => ({ ...prev, [id]: rating }));
    writeToSession((sid) => updateRating(sid, id, rating));
  }, [writeToSession]);

  const handleClearRating = useCallback((id: string) => {
    setRatings((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    writeToSession((sid) => clearRating(sid, id));
  }, [writeToSession]);

  const handleSaveEdit = useCallback((id: string, answer: string) => {
    setEditedAnswers((prev) => ({ ...prev, [id]: answer }));
    writeToSession((sid) => updateAnswer(sid, id, answer));
  }, [writeToSession]);

  const handleClearEdit = useCallback((id: string) => {
    setEditedAnswers((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    writeToSession((sid) => clearAnswer(sid, id));
  }, [writeToSession]);

  const handleSaveContextUrl = useCallback((id: string, url: string) => {
    setContextUrls((prev) => ({ ...prev, [id]: url }));
    writeToSession((sid) => updateContextUrl(sid, id, url));
  }, [writeToSession]);

  const handleClearContextUrl = useCallback((id: string) => {
    setContextUrls((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    writeToSession((sid) => clearContextUrl(sid, id));
  }, [writeToSession]);

  const handleSaveAssignee = useCallback((id: string, memberId: string) => {
    setAssignees((prev) => ({ ...prev, [id]: memberId }));
    writeToSession((sid) => updateAssignee(sid, id, memberId));
  }, [writeToSession]);

  const handleClearAssignee = useCallback((id: string) => {
    setAssignees((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    writeToSession((sid) => clearAssignee(sid, id));
  }, [writeToSession]);

  const handleSaveReviewer = useCallback((id: string, memberId: string) => {
    setReviewers((prev) => ({ ...prev, [id]: memberId }));
    writeToSession((sid) => updateReviewer(sid, id, memberId));
  }, [writeToSession]);

  const handleClearReviewer = useCallback((id: string) => {
    setReviewers((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    writeToSession((sid) => clearReviewer(sid, id));
  }, [writeToSession]);

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

  return (
    <div className="app-shell">
      <Sidebar
        activeView={activeView}
        onChangeView={handleChangeView}
        userEmail={userEmail}
        darkMode={darkMode}
        onToggleDark={toggleDark}
        onSignOut={onSignOut}
      />

      <div className="app-content">
        <Header
          data={data}
          filename={filename}
          unansweredCount={unansweredCount}
          totalCount={data?.items.length ?? 0}
          onLoad={handleLoad}
          teamMembers={teamMembers}
          docId={docId}
          editedAnswers={editedAnswers}
          ratings={ratings}
          contextUrls={contextUrls}
        />

        <div className={activeView === "database" ? "u-hide" : ""}>
          {/* Live session indicator */}
          {docId && (
            <div className="live-session-banner">
              <span className="live-session-banner__dot" />
              Live session, edits sync in real time
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

      {/* Write failure notice. Stays until dismissed, because an unsaved change is worth noticing
          rather than something to let fade away. */}
      {writeFailed && (
        <div className="write-toast">
          <div className="p-notification--negative u-no-margin--bottom" role="alert">
            <div className="p-notification__content">
              <h5 className="p-notification__title">Change may not have saved</h5>
              <p className="p-notification__message">
                Your change is still shown here, but it may not have reached the server. Check your
                connection, then make the change again to be sure it sticks.
              </p>
            </div>
            <button
              className="p-notification__close"
              onClick={() => setWriteFailed(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
