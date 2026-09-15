"use client";

import { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import type { ActiveView } from "@/components/Header";
import RfpDatabaseView from "@/components/RfpDatabaseView";
import OverviewView from "@/components/OverviewView";
import FilterBar from "@/components/FilterBar";
import SectionGroup from "@/components/SectionGroup";
import { groupBySection, getSections, isUnanswered } from "@/lib/utils";
import {
  ensureSession,
  newSessionState,
  subscribeToSession,
  updateAnswer,
  clearAnswer,
  updateRating,
  clearRating,
  updateItemStatus,
  clearItemStatus,
  updateSectionAssignee,
  clearSectionAssignee,
  updateSectionReviewer,
  clearSectionReviewer,
} from "@/lib/session";
import { getSavedFile } from "@/lib/savedFiles";
import { subscribeToTeamMembers } from "@/lib/teamBank";
import type {
  ParsedQAFile,
  Filters,
  ItemStatus,
  QAItem,
  SessionState,
  TeamMember,
  PersonFilterOption,
} from "@/lib/types";

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
  const [itemStatus, setItemStatus] = useState<Record<string, ItemStatus>>(
    () => initialState?.itemStatus ?? {}
  );
  const [sectionAssignees, setSectionAssignees] = useState<Record<string, string>>(
    () => initialState?.sectionAssignees ?? {}
  );
  const [sectionReviewers, setSectionReviewers] = useState<Record<string, string>>(
    () => initialState?.sectionReviewers ?? {}
  );
  // Read here, never written here: the dashboard owns this map. The inspector needs it because a
  // project's owners are the only people its sections may be handed to — see `assignableMembers`.
  const [projectAssignees, setProjectAssignees] = useState<Record<string, true>>(
    () => initialState?.projectAssignees ?? {}
  );
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  // A doc's session id is its saved-file id, so this doubles as session identity: opening the same
  // doc always joins the same room instead of minting a new random session.
  const [docId, setDocId] = useState<string | null>(null);
  // The dashboard is where a lead starts: which projects exist and who is on them is the question you
  // have before you have a document open, so it is the landing view rather than the inspector.
  //
  // Except when a document is already in hand. `initialState` means this shell was mounted around a
  // specific batch — the import handoff — and the reader's question is about that batch, not about the
  // portfolio. Landing on the dashboard there hides the very thing the mount was for.
  const [activeView, setActiveView] = useState<ActiveView>(
    initialState ? "inspector" : "overview"
  );
  const [hasVisitedDatabase, setHasVisitedDatabase] = useState(false);
  // Tracks the mount-once rule below, so it starts true only when the dashboard is the landing view.
  // Starting it unconditionally true mounted `OverviewView` — and issued its project-list read — even
  // for a mount that goes straight to the inspector and may never show the dashboard at all.
  const [hasVisitedOverview, setHasVisitedOverview] = useState(!initialState);
  // Bumped on each entry to the dashboard. Its project list is read one-shot rather than watched, so
  // this is what picks up projects added or exported elsewhere without a reload.
  const [overviewRefreshKey, setOverviewRefreshKey] = useState(0);
  // The project whose document is being fetched from a dashboard click, so its card can say so.
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
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

  // Per-view scroll position, restored when switching back
  const scrollPositions = useRef<Record<ActiveView, number>>({
    overview: 0,
    inspector: 0,
    database: 0,
  });

  // The previous view is read from state rather than from a `setActiveView` updater. React treats
  // updaters as pure and may re-invoke them, so bumping the refresh key inside one meant a single
  // switch into the dashboard could re-read the project list twice.
  const handleChangeView = useCallback(
    (view: ActiveView) => {
      if (view === activeView) return;
      scrollPositions.current[activeView] = window.scrollY;
      // Re-read the project list on each arrival, so the dashboard is never showing a list from
      // before the file that was just loaded, exported or removed.
      if (view === "overview") setOverviewRefreshKey((key) => key + 1);
      setActiveView(view);
    },
    [activeView]
  );

  // Mount each secondary view on first visit, then keep it mounted (never unmount again), so its
  // subscriptions and scroll position survive switching away.
  useEffect(() => {
    if (activeView === "database") setHasVisitedDatabase(true);
    if (activeView === "overview") setHasVisitedOverview(true);
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

  /**
   * The signed-in user's team-bank entry, or null before it arrives (or if they are not in the bank).
   *
   * Approving is the section reviewer's to do, so the cards need to know which `TeamMember.id` "me"
   * is. Matched on email rather than by sanitizing `userEmail` into a key here, which would be a
   * second copy of `teamBank`'s codec — the same mistake `encodeKey` exists to prevent. `OverviewView`
   * resolves itself the same way.
   */
  const me = useMemo(
    () =>
      userEmail
        ? teamMembers.find((m) => m.email.toLowerCase() === userEmail.toLowerCase()) ?? null
        : null,
    [teamMembers, userEmail]
  );

  /**
   * Who this project's sections may be handed to: its owners, and nobody else.
   *
   * Work flows through the project, not around it. A lead puts people on a project from the dashboard
   * (`projectAssignees`), and the section pickers in here offer exactly that set — so a section cannot
   * name somebody who is not on the project at all, which used to be possible and said nothing about
   * which of the two was wrong.
   *
   * **An unowned project has nobody to give its sections to**, deliberately: the list is empty until a
   * lead assigns owners, the same way an unreviewed section has nobody who can approve it. Falling back
   * to the whole bank would quietly undo the restriction on precisely the projects nobody has staffed.
   *
   * Filtered from `teamMembers` rather than built from the id map, so the order matches the bank and a
   * stale owner id — someone assigned and then removed from the bank — resolves to nothing instead of a
   * blank row. It stays the *full* bank that goes to `SectionGroup` alongside this: turning an id into a
   * name has to keep working for people this list excludes.
   */
  const assignableMembers = useMemo(
    // Truthiness, not `=== true`, matching `ownerIdsOf` on the dashboard: the two must agree about who
    // owns a project, and a strict comparison here would silently disagree with the dashboard's own list
    // over anything but a literal boolean.
    () => teamMembers.filter((m) => Boolean(projectAssignees[m.id])),
    [teamMembers, projectAssignees]
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
    setItemStatus((prev) => (sameMap(prev, state.itemStatus) ? prev : state.itemStatus));
    setSectionAssignees((prev) =>
      sameMap(prev, state.sectionAssignees) ? prev : state.sectionAssignees
    );
    setSectionReviewers((prev) =>
      sameMap(prev, state.sectionReviewers) ? prev : state.sectionReviewers
    );
    setProjectAssignees((prev) =>
      sameMap(prev, state.projectAssignees) ? prev : state.projectAssignees
    );
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
  const clearOverlays = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setEditedAnswers({});
    setRatings({});
    setContextUrls({});
    setItemStatus({});
    setSectionAssignees({});
    setSectionReviewers({});
    setProjectAssignees({});
  }, []);

  const handleLoad = useCallback((loaded: ParsedQAFile, name: string, loadedDocId: string) => {
    setData(loaded);
    setFilename(name);
    // Only when this is a *different* doc. Re-opening the doc already on screen — which is what clicking
    // it on the dashboard does, and the obvious way to go and look at a project you just assigned owners
    // to — used to wipe every overlay with nothing to put them back: `setDocId` bails out on an unchanged
    // value, so the subscription effect does not re-run, and `onValue` has already delivered its initial
    // snapshot and has no *change* to re-send. Owners, approvals and section assignees all read empty
    // until somebody else wrote something. The overlays already on screen belong to this doc, so there is
    // nothing to clear.
    if (docIdRef.current !== loadedDocId) clearOverlays();
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
    ensureSession(loadedDocId, newSessionState(loaded, name)).catch(() =>
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
   *
   * The view switches to the inspector up front, before the fetch resolves, rather than on success.
   * A link names one document, so the inspector is where the reader is going whatever comes back —
   * and `sharedDocState`'s "loading" and "missing" messages render inside the inspector, so leaving
   * the dashboard up until success meant a dead link said nothing at all.
   *
   * `setActiveView` directly rather than `handleChangeView`, because that callback changes identity
   * with `activeView` and this effect must not re-run — it would re-fetch on every view switch. None
   * of what it adds is wanted here anyway: there is no scroll position to save at mount, and no
   * project list to refresh on the way out of a dashboard nobody has looked at.
   */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("doc");
    if (!id) return;

    let active = true;
    setSharedDocState("loading");
    setActiveView("inspector");

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

  const handleApprove = useCallback((id: string) => {
    setItemStatus((prev) => ({ ...prev, [id]: "approved" }));
    writeToSession((sid) => updateItemStatus(sid, id, "approved"));
  }, [writeToSession]);

  const handleUnapprove = useCallback((id: string) => {
    setItemStatus((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    writeToSession((sid) => clearItemStatus(sid, id));
  }, [writeToSession]);

  const handleSaveSectionAssignee = useCallback((sectionKey: string, memberId: string) => {
    setSectionAssignees((prev) => ({ ...prev, [sectionKey]: memberId }));
    writeToSession((sid) => updateSectionAssignee(sid, sectionKey, memberId));
  }, [writeToSession]);

  const handleClearSectionAssignee = useCallback((sectionKey: string) => {
    setSectionAssignees((prev) => {
      const next = { ...prev };
      delete next[sectionKey];
      return next;
    });
    writeToSession((sid) => clearSectionAssignee(sid, sectionKey));
  }, [writeToSession]);

  const handleSaveSectionReviewer = useCallback((sectionKey: string, memberId: string) => {
    setSectionReviewers((prev) => ({ ...prev, [sectionKey]: memberId }));
    writeToSession((sid) => updateSectionReviewer(sid, sectionKey, memberId));
  }, [writeToSession]);

  const handleClearSectionReviewer = useCallback((sectionKey: string) => {
    setSectionReviewers((prev) => {
      const next = { ...prev };
      delete next[sectionKey];
      return next;
    });
    writeToSession((sid) => clearSectionReviewer(sid, sectionKey));
  }, [writeToSession]);

  /**
   * A document was exported and archived.
   *
   * Both the export stamp and the archive entry live outside anything the dashboard subscribes to, so
   * without this its completed list would keep the project in the active grid until the next time the
   * tab was entered from elsewhere.
   */
  const handleExported = useCallback(() => {
    setOverviewRefreshKey((key) => key + 1);
  }, []);

  /**
   * Open a project from the dashboard.
   *
   * The dashboard deliberately holds no documents, so the content has to be fetched before anything
   * can be shown — the same route the `?doc=` link takes. `handleLoad` then does the rest: it clears
   * the previous document's overlays, repoints the session subscription at the new room, seeds that
   * room if nobody has opened this project before, and syncs the address bar.
   */
  const handleOpenProject = useCallback(
    (projectId: string) => {
      setOpeningProjectId(projectId);
      getSavedFile(projectId)
        .then((saved) => {
          if (!saved) {
            showError(
              "That project is no longer available",
              "It has been removed from the shared list since this dashboard was loaded. Switch away and back to refresh the list."
            );
            return;
          }
          handleLoad(saved.data, saved.filename, saved.id);
          handleChangeView("inspector");
        })
        .catch(() =>
          showError(
            "Could not open that project",
            "Its results could not be loaded. Check your connection, then try again."
          )
        )
        .finally(() => setOpeningProjectId(null));
    },
    [handleLoad, handleChangeView, showError]
  );

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

  // Per-person filter options, computed dynamically from who actually owns or reviews a section of
  // the currently loaded file (not the full team bank). Read off the section maps because sections
  // are the only unit work is handed out in — this used to scan every item's own assignee.
  const personFilterOptions = useMemo((): PersonFilterOption[] => {
    if (!data) return [];

    function toOptions(
      roleMap: Record<string, string>,
      prefix: string,
      suffix: string
    ): PersonFilterOption[] {
      return Array.from(new Set(Object.values(roleMap)))
        .map((id) => teamMembers.find((m) => m.id === id))
        .filter((m): m is TeamMember => m !== undefined)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((m) => ({ value: `${prefix}:${m.id}`, label: `${m.name}'s ${suffix}` }));
    }

    return [
      ...toOptions(sectionAssignees, "assignee", "Sections"),
      ...toOptions(sectionReviewers, "reviewer", "Reviews"),
    ];
  }, [data, sectionAssignees, sectionReviewers, teamMembers]);

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

    // The person filter selects whole sections, so the matching set is read straight off the
    // section-keyed maps rather than reconstructed from which items a member happened to hold.
    let matchingSections: Set<string> | null = null;
    if (section.startsWith("assignee:") || section.startsWith("reviewer:")) {
      const [kind, memberId] = section.split(":", 2);
      const roleMap = kind === "assignee" ? sectionAssignees : sectionReviewers;
      matchingSections = new Set(
        Object.entries(roleMap)
          .filter(([, id]) => id === memberId)
          .map(([sectionKey]) => sectionKey)
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
  }, [data, filters, editedAnswers, sectionAssignees, sectionReviewers]);

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
        {/* The header is the open document's toolbar — file loader, filename, share, export, counts —
            so it has nothing to say on the dashboard, which is about the projects you have not opened.
            It renders outside the view toggle, so it is gated here rather than hidden by a class. */}
        {activeView !== "overview" && (
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
            onError={showError}
            onDocRemoved={handleDocRemoved}
            onExported={handleExported}
          />
        )}

        {hasVisitedOverview && (
          <div className={activeView === "overview" ? "" : "u-hide"}>
            <OverviewView
              teamMembers={teamMembers}
              userEmail={userEmail}
              onOpenProject={handleOpenProject}
              openingProjectId={openingProjectId}
              onError={showError}
              refreshKey={overviewRefreshKey}
            />
          </div>
        )}

        <div className={activeView === "inspector" ? "" : "u-hide"}>
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
                        itemStatus={itemStatus}
                        onApprove={handleApprove}
                        onUnapprove={handleUnapprove}
                        sectionAssignee={sectionAssignees[section]}
                        onSaveSectionAssignee={handleSaveSectionAssignee}
                        onClearSectionAssignee={handleClearSectionAssignee}
                        sectionReviewer={sectionReviewers[section]}
                        onSaveSectionReviewer={handleSaveSectionReviewer}
                        onClearSectionReviewer={handleClearSectionReviewer}
                        myMemberId={me?.id}
                        teamMembers={teamMembers}
                        assignableMembers={assignableMembers}
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
          // Tested for equality rather than inequality: with a third view, "not the inspector" was
          // also true on the dashboard, which would have shown the database underneath it.
          <div className={activeView === "database" ? "" : "u-hide"}>
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
