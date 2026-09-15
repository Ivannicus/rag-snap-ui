"use client";

import { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import type { ActiveView } from "@/components/Header";
import RfpDatabaseView from "@/components/RfpDatabaseView";
import FilterBar from "@/components/FilterBar";
import SectionGroup from "@/components/SectionGroup";
import { groupBySection, questionState, sectionKeyOf } from "@/lib/utils";
import { resolveSections, SECTION_ALGO_VERSION } from "@/lib/sectioning";
import {
  ensureSession,
  subscribeToSession,
  updateAnswer,
  clearAnswer,
  updateRating,
  clearRating,
  updateContextUrl,
  clearContextUrl,
  updateApproval,
  clearApproval,
  updateAssignee,
  clearAssignee,
  updateReviewer,
  clearReviewer,
} from "@/lib/session";
import { getSavedFile } from "@/lib/savedFiles";
import { subscribeToTeamMembers } from "@/lib/teamBank";
import {
  loadViewState,
  saveViewState,
  EMPTY_VIEW_STATE,
  type DocViewState,
} from "@/lib/expansion";
import type { ParsedQAFile, Filters, QAItem, SessionState, TeamMember, PersonFilterOption } from "@/lib/types";

const DEFAULT_FILTERS: Filters = { status: "all", section: "", search: "" };

/**
 * Read `filters.section` as a person filter, or null when it names a section instead.
 *
 * The one field carries both kinds of selection: a section key, or "assignee:<memberId>" /
 * "reviewer:<memberId>". Section keys are not ours to constrain — an explicit label out of the source
 * file is arbitrary text — so a document with a section literally called "assignee:2" would otherwise
 * be read as a person filter and never show its own questions. Checking the real keys first means a
 * section always wins the name it actually has; a person filter only has to avoid colliding with a
 * section that exists in the file being viewed.
 */
function parsePersonFilter(
  section: string,
  sectionKeys: Set<string>
): { roleKind: "assignee" | "reviewer"; memberId: string } | null {
  if (sectionKeys.has(section)) return null;
  for (const roleKind of ["assignee", "reviewer"] as const) {
    const prefix = `${roleKind}:`;
    if (section.startsWith(prefix)) {
      return { roleKind, memberId: section.slice(prefix.length) };
    }
  }
  return null;
}

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

/** Drop the doc from the address bar, so a reload does not try to reopen what was just removed. */
function clearDocParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("doc")) return;
  url.searchParams.delete("doc");
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
  // Approved question ids. Present means approved; there is no `false`, so an absent id is "ready".
  const [approvals, setApprovals] = useState<Record<string, true>>(
    () => initialState?.approvals ?? {}
  );
  // Keyed by section, not by question — questions are not individually assignable.
  const [sectionAssignees, setSectionAssignees] = useState<Record<string, string>>(
    () => initialState?.sectionAssignees ?? {}
  );
  const [sectionReviewers, setSectionReviewers] = useState<Record<string, string>>(
    () => initialState?.sectionReviewers ?? {}
  );
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  // Which cards are expanded and which sections are collapsed. Held here rather than inside each
  // card or section so it survives the remount a doc switch or a filter change causes, and so it
  // can be restored for the doc being opened.
  //
  // Held as the doc it belongs to plus its state, so a stale entry cannot be applied to the wrong
  // doc: a switch renders with `override.docId` still pointing at the previous doc, and the value
  // below falls back to the incoming doc's stored view for that render.
  const [override, setOverride] = useState<{ docId: string | null; state: DocViewState } | null>(
    null
  );
  // A doc's session id is its saved-file id, so this doubles as session identity: opening the same
  // doc always joins the same room instead of minting a new random session.
  const [docId, setDocId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>("inspector");
  const [hasVisitedDatabase, setHasVisitedDatabase] = useState(false);
  // Set when something that should have persisted did not. Without this the UI shows the change as
  // though it saved, because local state is updated independently of the write.
  const [errorNotice, setErrorNotice] = useState<{ title: string; message: string } | null>(null);
  // Opening a doc named in the URL takes a fetch, so between mount and that settling the view is
  // neither empty nor loaded. "missing" is a link whose doc is gone, which needs saying out loud —
  // it used to be indistinguishable from having opened nothing at all.
  const [sharedDocState, setSharedDocState] = useState<"none" | "loading" | "missing">("none");

  // One notification for the whole app. Stable, so callbacks that take it do not churn.
  const showError = useCallback((title: string, message: string) => {
    setErrorNotice({ title, message });
  }, []);

  // Mirrors docId for the URL-open effect below, which needs to know whether a doc has been opened
  // since its fetch started, but must not re-run when that changes.
  const docIdRef = useRef<string | null>(null);
  useEffect(() => {
    docIdRef.current = docId;
  }, [docId]);

  // Mirrors `approvals` for the edit handlers, which need to know whether a question was approved
  // before its answer changed without taking a render to find out. Kept in step by every writer
  // below and by the remote-snapshot effect.
  const approvalsRef = useRef<Record<string, true>>({});
  useEffect(() => {
    approvalsRef.current = approvals;
  }, [approvals]);

  // How this doc was last left, read back from localStorage. Derived rather than restored through an
  // effect: a doc switch has the incoming doc's view ready in the same render that changes `docId`,
  // so there is no frame showing the outgoing doc's open cards and no state to keep in step.
  const storedViewState = useMemo(
    () => (docId ? loadViewState(docId) : EMPTY_VIEW_STATE),
    [docId]
  );

  // What is actually open: this session's toggles if they belong to the doc on screen, else what was
  // stored for it. Closing a doc goes back to the defaults, since `loadViewState` is not consulted
  // without an id.
  const viewState = override?.docId === docId ? override.state : storedViewState;

  /**
   * Record a change to what is open.
   *
   * Persisted per doc on every change rather than on unload — there is no reliable moment to save on
   * the way out of a static page, and the writes are one small key each.
   */
  const commitViewState = useCallback(
    (next: DocViewState) => {
      setOverride({ docId, state: next });
      // No doc id means the postMessage import path, which has no identity to file this under. The
      // toggles still work for the visit, they just are not remembered.
      if (docId) saveViewState(docId, next);
    },
    [docId]
  );

  /** Open or close one card. */
  const handleSetExpanded = useCallback(
    (id: string, open: boolean) => {
      const expandedQuestions = { ...viewState.expandedQuestions };
      if (open) expandedQuestions[id] = true;
      else delete expandedQuestions[id];
      commitViewState({ ...viewState, expandedQuestions });
    },
    [commitViewState, viewState]
  );

  /**
   * Show or hide one section's questions.
   *
   * Only the section's own key moves. The cards' expansion is a separate set, so collapsing a
   * section hides whatever was open inside it and expanding it again brings that back unchanged.
   */
  const handleSetSectionOpen = useCallback(
    (sectionKey: string, open: boolean) => {
      const collapsedSections = { ...viewState.collapsedSections };
      if (open) delete collapsedSections[sectionKey];
      else collapsedSections[sectionKey] = true;
      commitViewState({ ...viewState, collapsedSections });
    },
    [commitViewState, viewState]
  );

  // Per-view scroll position, restored when switching back
  const scrollPositions = useRef<Record<ActiveView, number>>({ inspector: 0, database: 0 });

  function handleChangeView(view: ActiveView) {
    scrollPositions.current[activeView] = window.scrollY;
    // Mount the RFP Database view on first visit, then keep it mounted (never unmount again). Set
    // here rather than in an effect on `activeView`: this is the only thing that changes the view, so
    // the effect was a second render's worth of work to learn what this call already knows.
    if (view === "database") setHasVisitedDatabase(true);
    setActiveView(view);
  }

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

  // Load the persisted dark mode preference. It cannot be read in the initial state: this page is
  // prerendered as static HTML, so the first client render has to match markup produced without a
  // localStorage to consult. That makes this the one legitimate synchronous setState on mount.
  useEffect(() => {
    const stored = localStorage.getItem("darkMode");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe read of a stored preference
    if (stored === "true") setDarkMode(true);
  }, []);

  // Subscribe to the global team member bank
  useEffect(() => {
    return subscribeToTeamMembers(setTeamMembers);
  }, []);

  /**
   * Say so when a room's assignment was keyed under different sectioning rules than this build uses.
   *
   * Section keys are algorithm output, so a room seeded by another version keys its assignees and
   * reviewers to sections this build does not produce. Nothing here can repair that — the sections
   * those names were put against no longer exist — but the alternative is a file that reads as though
   * nobody was ever assigned to anything, which is the wrong thing for someone to conclude.
   *
   * Two ways a room can be in this state, and the second is the one that actually reaches users:
   *
   *  - It was seeded under a different SECTION_ALGO_VERSION, and still holds section-keyed assignment
   *    that no longer matches any section.
   *  - It predates the move from per-question to per-section assignment, so it holds the obsolete
   *    item-keyed nodes this build does not read. Those rooms carry no version stamp at all — it
   *    postdates them — so the version check alone would let the most common case through silently.
   *
   * Only worth saying when there is assignment to lose, and only once per room.
   */
  const mismatchWarnedFor = useRef<string | null>(null);
  const reportAlgoMismatch = useCallback(
    (state: SessionState) => {
      const { sectionAlgoVersion: stored } = state;
      const staleKeys =
        // Undefined means the room predates the stamp, which on its own is not evidence of a
        // mismatch: an unstamped room may well have been seeded by these very rules.
        stored !== undefined &&
        stored !== SECTION_ALGO_VERSION &&
        (Object.keys(state.sectionAssignees).length > 0 ||
          Object.keys(state.sectionReviewers).length > 0);
      if (!staleKeys && state.hasLegacyItemAssignment !== true) return;
      const room = docIdRef.current;
      if (mismatchWarnedFor.current === room) return;
      mismatchWarnedFor.current = room;
      showError(
        "Section assignments could not be matched up",
        "This file was shared using an older version of the app, which recorded assignments against a different breakdown of the questions. The assignees and reviewers saved then do not line up with the sections shown here, so every section starts unassigned. Assign them again to bring this file up to date."
      );
    },
    [showError]
  );

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
    setApprovals((prev) => (sameMap(prev, state.approvals) ? prev : state.approvals));
    setSectionAssignees((prev) =>
      sameMap(prev, state.sectionAssignees) ? prev : state.sectionAssignees
    );
    setSectionReviewers((prev) =>
      sameMap(prev, state.sectionReviewers) ? prev : state.sectionReviewers
    );
    reportAlgoMismatch(state);
  }, [reportAlgoMismatch]);

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
  const clearOverlays = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setEditedAnswers({});
    setRatings({});
    setContextUrls({});
    setApprovals({});
    approvalsRef.current = {};
    setSectionAssignees({});
    setSectionReviewers({});
  }, []);

  const handleLoad = useCallback((loaded: ParsedQAFile, name: string, loadedDocId: string) => {
    setData(loaded);
    setFilename(name);
    clearOverlays();
    setDocId(loadedDocId);
    syncDocParam(loadedDocId);
    // A doc is open, so whatever the URL was doing is finished. Clearing it here rather than only in
    // the effect below keeps a stale "file no longer available" notice from resurfacing later, when
    // the reader loads a file and then closes it again.
    setSharedDocState("none");

    // Seed the room for whoever opens this doc first. Existing sessions are left untouched, and
    // their overlays arrive through the subscription a moment later.
    //
    // The failure is reported rather than discarded. The doc opens and stays editable either way, so
    // there is nothing here for the person who loaded it to fix — but the seed is what carries this
    // doc into its room, and discarding the news that it failed is what let someone hand out a share
    // link that could only ever open onto nothing.
    ensureSession(loadedDocId, {
      data: loaded,
      filename: name,
      editedAnswers: {},
      ratings: {},
      contextUrls: {},
      approvals: {},
      sectionAssignees: {},
      sectionReviewers: {},
    }).catch(() =>
      showError(
        "Live sharing may not be ready",
        "This file is open and your changes are kept, but the shared session for it could not be started. People opening the share link may not see your edits until you reload this page."
      )
    );
  }, [clearOverlays, showError]);

  /**
   * Open the doc named in the URL.
   *
   * The content comes from the saved-file bank, not from the room. Those are two different nodes and
   * only one of them is certain to exist: subscribing and waiting for a snapshot meant that a link to
   * a doc whose room had never been seeded — because that write failed, or because the doc predates
   * rooms — showed "No file loaded" indefinitely, under a banner announcing a live session. Fetching
   * the content instead makes the link answerable from the doc itself, and routing it through
   * `handleLoad` seeds the room on the way in, so following such a link repairs the gap rather than
   * waiting on it.
   */
  // The "loading" state cannot be the initial one: this page is prerendered as static HTML, so the
  // first client render has to match markup produced without a URL to read. Announcing the fetch is
  // therefore the second render either way.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("doc");
    if (!id) return;

    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe read of the address bar
    setSharedDocState("loading");

    getSavedFile(id)
      .then((saved) => {
        if (!active) return;
        // A slow fetch must not reach past a doc the reader opened themselves while it was in
        // flight. Their choice is the more recent one, so it stands and this result is dropped.
        if (docIdRef.current) {
          setSharedDocState("none");
          return;
        }
        if (!saved) {
          // The link outlived the file. Drop the id from the address bar so a reload stops retrying
          // a doc that is not coming back.
          setSharedDocState("missing");
          clearDocParam();
          return;
        }
        handleLoad(saved.data, saved.filename, saved.id);
      })
      .catch(() => {
        if (!active) return;
        // Unlike a missing doc, this may well succeed on a retry, so the id stays in the URL.
        setSharedDocState("none");
        showError(
          "Could not open that link",
          "The file this link points to could not be loaded. Check your connection, then reload the page to try again."
        );
      });

    return () => {
      active = false;
    };
  }, [handleLoad, showError]);

  /**
   * Close the open doc, back to the state before anything was loaded.
   *
   * This takes the same route as opening a different doc: `setDocId` is what the subscription
   * effect keys on, so setting it to null runs that effect's cleanup and detaches the listener,
   * exactly as a switch does. There is no separate teardown to keep in step.
   *
   * Local only. Nothing under `/sessions/<docId>` is written or deleted, so anyone else with this
   * doc open keeps their session and their overlays untouched.
   */
  const handleCloseDoc = useCallback(() => {
    setData(null);
    setFilename(null);
    clearOverlays();
    setDocId(null);
    clearDocParam();
  }, [clearOverlays]);

  /**
   * A doc was removed from the shared bank. Only the doc on screen closes; removing any other doc
   * from the loader list just drops it from that list and leaves the current work alone.
   */
  const handleDocRemoved = useCallback(
    (removedDocId: string) => {
      if (removedDocId !== docId) return;
      handleCloseDoc();
    },
    [docId, handleCloseDoc]
  );

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
      write(docId).catch(() =>
        showError(
          "Change may not have saved",
          "Your change is still shown here, but it may not have reached the server. Check your connection, then make the change again to be sure it sticks."
        )
      );
    },
    [docId, showError]
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

  /**
   * Set or clear one question's approval.
   *
   * Approving is a collaborative act, so it goes to the room like an edit does — everyone in the
   * session sees the box turn green.
   */
  const handleSetApproved = useCallback(
    (id: string, approved: boolean) => {
      const next = { ...approvalsRef.current };
      if (approved) next[id] = true;
      else delete next[id];
      approvalsRef.current = next;
      setApprovals(next);
      writeToSession((sid) => (approved ? updateApproval(sid, id) : clearApproval(sid, id)));
    },
    [writeToSession]
  );

  /**
   * Withdraw an approval because the answer text changed under it.
   *
   * An approval means a human read *that text* and signed off on it, so any change to the effective
   * answer — saving an edit, or reverting one — sends the question back to Ready for a fresh look.
   * Silent about it when the question was not approved, which is the common case.
   */
  const revokeApprovalForEdit = useCallback(
    (id: string) => {
      if (!approvalsRef.current[id]) return;
      handleSetApproved(id, false);
    },
    [handleSetApproved]
  );

  const handleSaveEdit = useCallback((id: string, answer: string) => {
    setEditedAnswers((prev) => ({ ...prev, [id]: answer }));
    writeToSession((sid) => updateAnswer(sid, id, answer));
    revokeApprovalForEdit(id);
  }, [writeToSession, revokeApprovalForEdit]);

  const handleClearEdit = useCallback((id: string) => {
    setEditedAnswers((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    revokeApprovalForEdit(id);
    writeToSession((sid) => clearAnswer(sid, id));
  }, [writeToSession, revokeApprovalForEdit]);

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

  // All four take a SectionInfo.key. Assignment is a property of a section, so there is no
  // per-question path into these any more.
  const handleSaveAssignee = useCallback((sectionKey: string, memberId: string) => {
    setSectionAssignees((prev) => ({ ...prev, [sectionKey]: memberId }));
    writeToSession((sid) => updateAssignee(sid, sectionKey, memberId));
  }, [writeToSession]);

  const handleClearAssignee = useCallback((sectionKey: string) => {
    setSectionAssignees((prev) => {
      const next = { ...prev };
      delete next[sectionKey];
      return next;
    });
    writeToSession((sid) => clearAssignee(sid, sectionKey));
  }, [writeToSession]);

  const handleSaveReviewer = useCallback((sectionKey: string, memberId: string) => {
    setSectionReviewers((prev) => ({ ...prev, [sectionKey]: memberId }));
    writeToSession((sid) => updateReviewer(sid, sectionKey, memberId));
  }, [writeToSession]);

  const handleClearReviewer = useCallback((sectionKey: string) => {
    setSectionReviewers((prev) => {
      const next = { ...prev };
      delete next[sectionKey];
      return next;
    });
    writeToSession((sid) => clearReviewer(sid, sectionKey));
  }, [writeToSession]);

  /** The three tallies the top bar reports, counted once over the whole file. */
  const stateCounts = useMemo(() => {
    const counts = { unanswered: 0, ready: 0, approved: 0 };
    for (const item of data?.items ?? []) {
      counts[questionState(item.answer, editedAnswers[item.id], approvals[item.id] === true)]++;
    }
    return counts;
  }, [data, editedAnswers, approvals]);

  /**
   * Sections are resolved once per file, from the *full* item list.
   *
   * Deliberately memoised on `data` alone. Resolving over filteredItems would let topic
   * inference redraw its boundaries on every keystroke in the search box, rearranging sections
   * under the user and appearing to move assignments between them.
   */
  const sectionMap = useMemo(
    () => resolveSections(data?.items ?? []),
    [data]
  );

  const sectionKeys = useMemo(
    () => new Set(sectionMap.sections.map((s) => s.key)),
    [sectionMap]
  );

  // Per-person filter options, computed dynamically from who actually has
  // assignments/reviews in the currently loaded file (not the full team bank).
  const personFilterOptions = useMemo((): PersonFilterOption[] => {
    if (!data) return [];

    // Walks sections rather than items: a role map is keyed by section now, so an entry for a
    // section the current file does not contain must not raise a filter option.
    function distinctMemberIds(roleMap: Record<string, string>): Set<string> {
      const ids = new Set<string>();
      for (const section of sectionMap.sections) {
        const id = roleMap[section.key];
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
      ...toOptions(distinctMemberIds(sectionAssignees), "assignee", "Assignments"),
      ...toOptions(distinctMemberIds(sectionReviewers), "reviewer", "Reviews"),
    ];
  }, [data, sectionAssignees, sectionReviewers, teamMembers, sectionMap]);

  /**
   * The filters actually in force.
   *
   * A person filter whose option has gone — their last assignment was cleared, or they were removed
   * from the team bank — falls back to "All sections" rather than silently showing nothing. Derived
   * rather than written back into `filters`: correcting it through an effect meant a render where the
   * list really was empty, and the dropdown had to be told twice what it was already showing.
   */
  const effectiveFilters = useMemo((): Filters => {
    const { section } = filters;
    if (parsePersonFilter(section, sectionKeys) === null) return filters;
    if (personFilterOptions.some((opt) => opt.value === section)) return filters;
    return { ...filters, section: "" };
  }, [filters, personFilterOptions, sectionKeys]);

  const filteredItems = useMemo((): QAItem[] => {
    if (!data) return [];
    const { status, section, search } = effectiveFilters;
    const term = search.toLowerCase();

    let matchingSections: Set<string> | null = null;
    const person = parsePersonFilter(section, sectionKeys);
    if (person) {
      const roleMap =
        person.roleKind === "assignee" ? sectionAssignees : sectionReviewers;
      matchingSections = new Set(
        sectionMap.sections
          .filter((sec) => roleMap[sec.key] === person.memberId)
          .map((sec) => sec.key)
      );
    }

    return data.items.filter((item) => {
      const effectiveAnswer = editedAnswers[item.id] ?? item.answer;
      // "Approved" is a human sign-off now, not "the model answered it", so this filter no longer
      // matches a question just because it has answer text. Ready questions are reachable through
      // "All".
      const state = questionState(
        item.answer,
        editedAnswers[item.id],
        approvals[item.id] === true
      );
      if (status === "approved" && state !== "approved") return false;
      if (status === "unanswered" && state !== "unanswered") return false;
      if (matchingSections) {
        if (!matchingSections.has(sectionKeyOf(sectionMap, item))) return false;
      } else if (section && sectionKeyOf(sectionMap, item) !== section) {
        return false;
      }
      if (term) {
        const inQ = item.question.toLowerCase().includes(term);
        const inA = effectiveAnswer.toLowerCase().includes(term);
        if (!inQ && !inA) return false;
      }
      return true;
    });
  }, [
    data,
    effectiveFilters,
    editedAnswers,
    approvals,
    sectionAssignees,
    sectionReviewers,
    sectionMap,
    sectionKeys,
  ]);

  const grouped = useMemo(
    () => groupBySection(filteredItems, sectionMap),
    [filteredItems, sectionMap]
  );

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
          readyCount={stateCounts.ready}
          approvedCount={stateCounts.approved}
          unansweredCount={stateCounts.unanswered}
          totalCount={data?.items.length ?? 0}
          onLoad={handleLoad}
          teamMembers={teamMembers}
          docId={docId}
          editedAnswers={editedAnswers}
          ratings={ratings}
          contextUrls={contextUrls}
          onError={showError}
          onDocRemoved={handleDocRemoved}
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
              {/* The effective filters, so a person filter that fell away shows as "All sections"
                  rather than as an option the dropdown no longer has. */}
              <FilterBar
                filters={effectiveFilters}
                sections={sectionMap.sections}
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
                    {grouped.map(({ section, items }, sectionIndex) => (
                      <SectionGroup
                        key={section.key}
                        section={section}
                        // Position in the rendered list, used only to mint a DOM id for the
                        // section's panel. Section keys cannot do that job: they carry spaces and
                        // punctuation, and squeezing those out collides ("A/B" and "A B" both
                        // become "A-B"), which would point one header's aria-controls at another
                        // section's questions.
                        index={sectionIndex}
                        items={items}
                        searchTerm={effectiveFilters.search}
                        editedAnswers={editedAnswers}
                        onSaveEdit={handleSaveEdit}
                        onClearEdit={handleClearEdit}
                        ratings={ratings}
                        onSaveRating={handleSaveRating}
                        onClearRating={handleClearRating}
                        contextUrls={contextUrls}
                        onSaveContextUrl={handleSaveContextUrl}
                        onClearContextUrl={handleClearContextUrl}
                        approvals={approvals}
                        onSetApproved={handleSetApproved}
                        expandedIds={viewState.expandedQuestions}
                        onSetExpanded={handleSetExpanded}
                        open={viewState.collapsedSections[section.key] !== true}
                        onSetOpen={handleSetSectionOpen}
                        assignee={sectionAssignees[section.key]}
                        onSaveAssignee={handleSaveAssignee}
                        onClearAssignee={handleClearAssignee}
                        reviewer={sectionReviewers[section.key]}
                        onSaveReviewer={handleSaveReviewer}
                        onClearReviewer={handleClearReviewer}
                        teamMembers={teamMembers}
                      />
                    ))}
                  </div>
                )}

              </main>
            </>
          ) : sharedDocState === "loading" ? (
            <main className="app-main no-file-state">
              <i className="p-icon--spinner u-animation--spin p-icon--xx-large"></i>
              <h2 className="p-heading--2">Opening shared file</h2>
              <p className="u-text--muted">Fetching the file this link points to.</p>
            </main>
          ) : (
            <main className="app-main no-file-state">
              {/* A dead share link is worth naming. Left unsaid, it looks exactly like never having
                  opened anything, and the reader is left to wonder whether the link or the app is
                  at fault. */}
              {sharedDocState === "missing" && (
                <div
                  className="p-notification--caution no-file-state__notice"
                  role="status"
                >
                  <div className="p-notification__content">
                    <h5 className="p-notification__title">File no longer available</h5>
                    <p className="p-notification__message">
                      The file this link points to has been removed from the shared list. Load
                      another file below, or ask whoever shared the link for an up-to-date one.
                    </p>
                  </div>
                </div>
              )}
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

      {/* Failure notice. Stays until dismissed, because something that did not persist is worth
          noticing rather than something to let fade away. */}
      {errorNotice && (
        <div className="write-toast">
          <div className="p-notification--negative u-no-margin--bottom" role="alert">
            <div className="p-notification__content">
              <h5 className="p-notification__title">{errorNotice.title}</h5>
              <p className="p-notification__message">{errorNotice.message}</p>
            </div>
            <button
              className="p-notification__close"
              onClick={() => setErrorNotice(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
