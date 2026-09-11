"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ProjectCard from "./ProjectCard";
import ProjectListRow from "./ProjectListRow";
import ProjectSummaryStrip from "./ProjectSummaryStrip";
import CompletedProjectsList from "./CompletedProjectsList";
import MyAssignments from "./MyAssignments";
import TeamMemberMultiSelect from "./TeamMemberMultiSelect";
import { listProjectMetas, setDueDate } from "@/lib/savedFiles";
import { listArchivedProjects } from "@/lib/archive";
import { setProjectAssignees } from "@/lib/session";
import {
  EMPTY_OVERLAYS,
  STATUS_BANDS,
  computeProjectStats,
  isOverdue,
  ownerIdsOf,
  sameOverlays,
  subscribeToProjectOverlays,
} from "@/lib/projects";
import type {
  ArchivedProjectMeta,
  ProjectMeta,
  ProjectOverlays,
  ProjectSummary,
  TeamMember,
} from "@/lib/types";

type SortKey = "dueDate" | "progress" | "filename" | "uploadedAt";
type StatusFilter = "all" | "in-progress" | "complete" | "overdue";
type Tab = "projects" | "mine";
/** Cards show a project's full detail; the list trades that for rows that compare down a column. */
type ViewMode = "cards" | "list";

const VIEW_MODE_KEY = "overviewViewMode";

interface Props {
  teamMembers: TeamMember[];
  userEmail?: string;
  /** Open a project in the collaborative inspector. Resolves once its document has loaded. */
  onOpenProject: (projectId: string) => void;
  /** The project currently being fetched, so its card can show progress. */
  openingProjectId: string | null;
  onError: (title: string, message: string) => void;
  /**
   * Bumped by the shell each time the dashboard is shown. The project list is read one-shot rather
   * than watched (see `listProjectMetas`), so this is what brings in projects added, removed or
   * exported elsewhere without a page reload.
   */
  refreshKey: number;
}

export default function OverviewView({
  teamMembers,
  userEmail,
  onOpenProject,
  openingProjectId,
  onError,
  refreshKey,
}: Props) {
  const [metas, setMetas] = useState<ProjectMeta[] | null>(null);
  const [overlaysById, setOverlaysById] = useState<Record<string, ProjectOverlays>>({});
  const [archived, setArchived] = useState<ArchivedProjectMeta[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("projects");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [sortKey, setSortKey] = useState<SortKey>("dueDate");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // ── View mode ──
  //
  // Read after mount rather than in the initial state, because `output: 'export'` prerenders this and
  // an initial value taken from `localStorage` would not match the prerendered HTML. Same reason
  // `AppShell` loads the dark-mode preference in an effect.
  useEffect(() => {
    if (localStorage.getItem(VIEW_MODE_KEY) === "list") setViewMode("list");
  }, []);

  const changeViewMode = useCallback((next: ViewMode) => {
    setViewMode(next);
    localStorage.setItem(VIEW_MODE_KEY, next);
  }, []);

  // ── Project list and archive: one-shot, re-read whenever the dashboard is shown ──
  useEffect(() => {
    let active = true;
    setLoadError(null);

    listProjectMetas()
      .then((next) => {
        if (active) setMetas(next);
      })
      .catch(() => {
        if (!active) return;
        setMetas([]);
        setLoadError("The project list could not be loaded. Check your connection and try again.");
      });

    setArchiveLoading(true);
    listArchivedProjects()
      .then((next) => {
        if (!active) return;
        setArchived(next);
        setArchiveLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setArchived([]);
        setArchiveLoading(false);
      });

    return () => {
      active = false;
    };
  }, [refreshKey]);

  // ── Per-project overlay subscriptions ──
  //
  // Keyed on the joined id list rather than on `metas` itself, so a re-read that returns the same
  // projects does not tear down and re-attach every listener. Each project's callback replaces only
  // its own entry, and `sameOverlays` drops the snapshots that carry no change — without it every
  // snapshot for any project would produce a new state object and re-render the whole grid, since
  // nothing in this tree is memoized.
  const projectIds = useMemo(() => (metas ?? []).map((m) => m.id), [metas]);
  const projectIdKey = projectIds.join(",");

  useEffect(() => {
    if (projectIds.length === 0) return;
    const unsubscribes = projectIds.map((id) =>
      subscribeToProjectOverlays(id, (overlays) => {
        setOverlaysById((prev) => {
          const existing = prev[id];
          if (existing && sameOverlays(existing, overlays)) return prev;
          return { ...prev, [id]: overlays };
        });
      })
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIdKey]);

  // Drop overlays for projects that are no longer listed, so a removed project cannot keep feeding
  // stale counts into the summary strip.
  useEffect(() => {
    setOverlaysById((prev) => {
      const kept = Object.keys(prev).filter((id) => projectIds.includes(id));
      if (kept.length === Object.keys(prev).length) return prev;
      return Object.fromEntries(kept.map((id) => [id, prev[id]]));
    });
  }, [projectIdKey, projectIds]);

  const projects = useMemo((): ProjectSummary[] => {
    return (metas ?? []).map((meta) => {
      const overlays = overlaysById[meta.id] ?? EMPTY_OVERLAYS;
      return { meta, overlays, stats: computeProjectStats(meta, overlays) };
    });
  }, [metas, overlaysById]);

  const liveProjectIds = useMemo(() => new Set(projectIds), [projectIds]);

  const me = useMemo(
    () =>
      userEmail
        ? teamMembers.find((m) => m.email.toLowerCase() === userEmail.toLowerCase()) ?? null
        : null,
    [teamMembers, userEmail]
  );

  // Only members who actually own something appear in the filter, so the dropdown describes this
  // dashboard rather than the whole team bank.
  const ownerOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const p of projects) for (const id of ownerIdsOf(p.overlays)) ids.add(id);
    return teamMembers
      .filter((m) => ids.has(m.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [projects, teamMembers]);

  // If the filtered owner stops owning anything, fall back to all rather than showing an empty grid
  // with no explanation — same fallback the inspector's person filter uses.
  useEffect(() => {
    if (!ownerFilter) return;
    if (!ownerOptions.some((m) => m.id === ownerFilter)) setOwnerFilter("");
  }, [ownerOptions, ownerFilter]);

  const visibleProjects = useMemo(() => {
    const filtered = projects.filter(({ meta, overlays, stats }) => {
      if (ownerFilter && !ownerIdsOf(overlays).includes(ownerFilter)) return false;
      if (statusFilter === "complete" && !stats.complete) return false;
      if (statusFilter === "in-progress" && stats.complete) return false;
      if (statusFilter === "overdue" && !isOverdue(meta, stats)) return false;
      return true;
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case "dueDate": {
          // Projects with no due date sort last rather than first, so an unscheduled project never
          // outranks one that is actually due.
          const aDue = a.meta.dueDate ? Date.parse(a.meta.dueDate) : Number.POSITIVE_INFINITY;
          const bDue = b.meta.dueDate ? Date.parse(b.meta.dueDate) : Number.POSITIVE_INFINITY;
          if (aDue !== bDue) return aDue - bDue;
          return a.meta.filename.localeCompare(b.meta.filename);
        }
        case "progress":
          if (a.stats.approvedFraction !== b.stats.approvedFraction) {
            return a.stats.approvedFraction - b.stats.approvedFraction;
          }
          return a.meta.filename.localeCompare(b.meta.filename);
        case "filename":
          return a.meta.filename.localeCompare(b.meta.filename);
        case "uploadedAt":
        default:
          return b.meta.uploadedAt - a.meta.uploadedAt;
      }
    });
    return sorted;
  }, [projects, ownerFilter, statusFilter, sortKey]);

  // Selection is kept as ids, so it survives a re-read of the project list — but a project that has
  // been filtered out of view must not stay silently selected and then get bulk-assigned.
  const visibleIds = useMemo(() => visibleProjects.map((p) => p.meta.id), [visibleProjects]);
  const effectiveSelection = useMemo(
    () => selectedIds.filter((id) => visibleIds.includes(id)),
    [selectedIds, visibleIds]
  );

  const toggleSelected = useCallback((projectId: string) => {
    setSelectedIds((prev) =>
      prev.includes(projectId) ? prev.filter((id) => id !== projectId) : [...prev, projectId]
    );
  }, []);

  // ── Writes ──

  const reportWriteFailure = useCallback(
    (what: string) => {
      onError(
        `${what} may not have saved`,
        "Your change is shown here, but it may not have reached the server. Check your connection, then make the change again to be sure it sticks."
      );
    },
    [onError]
  );

  const handleChangeOwners = useCallback(
    (projectId: string, memberIds: string[]) => {
      const previous = ownerIdsOf(overlaysById[projectId] ?? EMPTY_OVERLAYS);
      // No optimistic update: owners live in a subscribed map, so the change comes back through the
      // listener within a tick, and RTDB reflects a local write locally before the server confirms it.
      setProjectAssignees(projectId, memberIds, previous).catch(() =>
        reportWriteFailure("Team assignment")
      );
    },
    [overlaysById, reportWriteFailure]
  );

  const handleChangeDueDate = useCallback(
    (projectId: string, isoDate: string | null) => {
      // Due dates live in the one-shot metadata rather than in a subscribed map, so nothing will tell
      // this view about the change. Update locally and let the toast be the only sign if it failed.
      setMetas((prev) =>
        prev
          ? prev.map((meta) => (meta.id === projectId ? { ...meta, dueDate: isoDate } : meta))
          : prev
      );
      setDueDate(projectId, isoDate).catch(() => reportWriteFailure("Due date"));
    },
    [reportWriteFailure]
  );

  /** Add owners to every selected project, leaving the owners each already has in place. */
  const handleBulkAssign = useCallback(
    (memberIds: string[]) => {
      if (memberIds.length === 0 || effectiveSelection.length === 0) return;
      for (const projectId of effectiveSelection) {
        const previous = ownerIdsOf(overlaysById[projectId] ?? EMPTY_OVERLAYS);
        const merged = Array.from(new Set([...previous, ...memberIds]));
        setProjectAssignees(projectId, merged, previous).catch(() =>
          reportWriteFailure("Bulk assignment")
        );
      }
      setSelectedIds([]);
    },
    [effectiveSelection, overlaysById, reportWriteFailure]
  );

  // ── Render ──

  if (metas === null) {
    return (
      <main className="app-main overview">
        <div className="overview__loading">
          <i className="p-icon--spinner u-animation--spin p-icon--large" aria-hidden></i>
          <p className="u-text--muted u-no-margin--bottom">Loading projects…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="app-main overview">
      <div className="overview__head">
        <div>
          <h2 className="p-heading--4 u-no-margin--bottom">Overview</h2>
          <p className="u-text--muted p-text--small u-no-margin--bottom">
            Every project in the shared list, with live progress as the team works.
          </p>
        </div>
        <div className="overview__tabs">
          <button
            type="button"
            onClick={() => setTab("projects")}
            aria-pressed={tab === "projects"}
            className={`is-dense u-no-margin--bottom file-loader__button ${
              tab === "projects" ? "p-button--brand" : "p-button--base"
            }`}
          >
            All projects
          </button>
          <button
            type="button"
            onClick={() => setTab("mine")}
            aria-pressed={tab === "mine"}
            className={`is-dense u-no-margin--bottom file-loader__button ${
              tab === "mine" ? "p-button--brand" : "p-button--base"
            }`}
          >
            My assignments
          </button>
        </div>
      </div>

      {loadError && (
        <div className="p-notification--negative" role="alert">
          <div className="p-notification__content">
            <p className="p-notification__message">{loadError}</p>
          </div>
        </div>
      )}

      <ProjectSummaryStrip projects={projects} archivedCount={archived.length} />

      {tab === "mine" ? (
        <MyAssignments me={me} projects={projects} onOpenProject={onOpenProject} />
      ) : (
        <>
          <div className="overview__controls">
            <label className="overview__control">
              <span className="u-text--muted p-text--small">Sort by</span>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="u-no-margin--bottom"
              >
                <option value="dueDate">Due date</option>
                <option value="progress">Least complete first</option>
                <option value="filename">Name</option>
                <option value="uploadedAt">Recently uploaded</option>
              </select>
            </label>

            <label className="overview__control">
              <span className="u-text--muted p-text--small">Owner</span>
              <select
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                className="u-no-margin--bottom"
              >
                <option value="">Anyone</option>
                {ownerOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="overview__control">
              <span className="u-text--muted p-text--small">Status</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="u-no-margin--bottom"
              >
                <option value="all">All</option>
                <option value="in-progress">In progress</option>
                <option value="complete">Fully approved</option>
                <option value="overdue">Overdue</option>
              </select>
            </label>

            {/* The count sits in the slot the "View" label used to hold: it says what is being shown,
                directly over the control that decides how, so the label was saying nothing the two
                buttons do not already say. `--view` carries the auto margin that used to be on
                `.overview__count`, so the group still ends up hard right. */}
            <div className="overview__control overview__control--view">
              <span className="u-text--muted p-text--small overview__count">
                Showing {visibleProjects.length} of {projects.length}
              </span>
              {/* Vanilla's segmented control: square-cornered and joined by design, which is what a
                  two-way view choice should look like next to three selects. It ships no active-state
                  styling of its own, so the pressed button carries `p-button--brand` — the same
                  brand/base pairing the tabs above use. Its own `border-radius: 0` is set at
                  specificity 0,2,0 and so survives the button class. */}
              <div className="p-segmented-control is-dense overview__view-toggle">
                <div className="p-segmented-control__list" role="group" aria-label="Project view">
                  {([
                    { mode: "cards", label: "Cards", icon: "p-icon--switcher-dashboard" },
                    { mode: "list", label: "List", icon: "p-icon--menu" },
                  ] as const).map(({ mode, label, icon }) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => changeViewMode(mode)}
                      aria-pressed={viewMode === mode}
                      className={`p-segmented-control__button ${
                        viewMode === mode ? "p-button--brand" : "p-button--base"
                      }`}
                    >
                      {/* No space between the two: the gap is a margin on the icon, because Vanilla
                          gives an icon that is a button's only element child a *negative* right margin
                          (`:last-child` in `%vf-button-has-icon`) which ate a space in the markup and
                          pulled the label onto the icon. See `.overview__view-toggle`. */}
                      <i
                        className={`${icon}${viewMode === mode ? " is-light" : ""}`}
                        aria-hidden
                      ></i>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {effectiveSelection.length > 0 && (
            <div className="overview__bulk">
              <span>
                <strong>{effectiveSelection.length}</strong>{" "}
                {effectiveSelection.length === 1 ? "project" : "projects"} selected
              </span>
              <TeamMemberMultiSelect
                label=""
                value={[]}
                teamMembers={teamMembers}
                onChange={handleBulkAssign}
                emptyLabel="Add owners to selected"
              />
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="p-button--base is-dense u-no-margin--bottom"
              >
                Clear selection
              </button>
            </div>
          )}

          {projects.length === 0 ? (
            <div className="empty-state">
              <i className="p-icon--file p-icon--xx-large u-text--muted"></i>
              <p className="p-heading--4">No projects yet</p>
              <p className="u-text--muted">
                Open the Collaborative UI and load a JSON file to start a project.
              </p>
            </div>
          ) : visibleProjects.length === 0 ? (
            <div className="empty-state">
              <i className="p-icon--filter p-icon--xx-large u-text--muted"></i>
              <p className="p-heading--4">No projects match these filters</p>
              <button
                type="button"
                onClick={() => {
                  setOwnerFilter("");
                  setStatusFilter("all");
                }}
                className="p-button--link u-no-margin--bottom"
              >
                Clear filters
              </button>
            </div>
          ) : viewMode === "list" ? (
            <div className="project-list">
              {/* Column labels, on the same grid as the rows. The bar and the badge cluster are not
                  self-describing the way a filename is, and this is the only place the list says what
                  the coloured lengths mean. */}
              {/* One cell per track of `.project-list__row`, including the three status bands, which
                  each own a column so a band at zero leaves its slot empty rather than shifting the
                  bands after it. Order follows `STATUS_BANDS`.

                  Every title reads from the left edge of its own column, and so does the cell under it.
                  What is anchored to the row's right edge is the group of columns, not the text inside
                  them — that comes from the name being the only elastic track. */}
              <div className="project-list__row project-list__head" aria-hidden>
                <span></span>
                <span className="u-text--muted p-text--small">Project</span>
                <span className="u-text--muted p-text--small">Progress</span>
                {STATUS_BANDS.map((band) => (
                  <span key={band.key} className="u-text--muted p-text--small">
                    {band.short}
                  </span>
                ))}
                <span className="u-text--muted p-text--small">Team</span>
              </div>
              {visibleProjects.map((project) => (
                <ProjectListRow
                  key={project.meta.id}
                  project={project}
                  teamMembers={teamMembers}
                  opening={openingProjectId === project.meta.id}
                  selected={effectiveSelection.includes(project.meta.id)}
                  onToggleSelected={toggleSelected}
                  onOpen={onOpenProject}
                  onChangeOwners={handleChangeOwners}
                />
              ))}
            </div>
          ) : (
            <div className="project-grid">
              {visibleProjects.map((project) => (
                <ProjectCard
                  key={project.meta.id}
                  project={project}
                  teamMembers={teamMembers}
                  opening={openingProjectId === project.meta.id}
                  selected={effectiveSelection.includes(project.meta.id)}
                  onToggleSelected={toggleSelected}
                  onOpen={onOpenProject}
                  onChangeOwners={handleChangeOwners}
                  onChangeDueDate={handleChangeDueDate}
                />
              ))}
            </div>
          )}

          <CompletedProjectsList
            archived={archived}
            loading={archiveLoading}
            liveProjectIds={liveProjectIds}
            onOpenProject={onOpenProject}
            onError={onError}
          />
        </>
      )}
    </main>
  );
}
