import { ref, onValue } from 'firebase/database';
import { db } from './firebase';
import { decodeKeys } from './session';
import type {
  ItemStatus,
  ProjectMeta,
  ProjectOverlays,
  ProjectStats,
  TeamMember,
} from './types';

/**
 * The dashboard's read layer.
 *
 * The one rule here: never read `sessions/<id>/data` or `savedFiles/<id>/data`. A dashboard showing
 * thirty projects that each pulled its own document would transfer the entire corpus, twice over,
 * before drawing a single card. So it reads project metadata once (`listProjectMetas`) and then
 * subscribes to the small overlay maps under each session node individually.
 */

export const EMPTY_OVERLAYS: ProjectOverlays = {
  itemStatus: {},
  editedAnswers: {},
  ratings: {},
  sectionAssignees: {},
  projectAssignees: {},
};

/**
 * The overlay children this subscribes to, and nothing else.
 *
 * `contextUrls` and `sectionReviewers` are left out because no band, badge or filter on the dashboard
 * reads them, and `data` is the whole point of the exercise. `editedAnswers` is the one member that
 * carries text rather than short values; it is here because an item the AI left blank and a human has
 * since filled is *ready*, not *unanswered*, and its keys are the only record of which blanks those
 * are.
 */
const OVERLAY_KEYS = [
  'itemStatus',
  'editedAnswers',
  'ratings',
  'sectionAssignees',
  'projectAssignees',
] as const satisfies readonly (keyof ProjectOverlays)[];

/** Shallow value equality, so an unchanged snapshot does not become a re-render. */
function sameMap<T>(a: Record<string, T>, b: Record<string, T>): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

export function sameOverlays(a: ProjectOverlays, b: ProjectOverlays): boolean {
  return OVERLAY_KEYS.every((key) =>
    sameMap(a[key] as Record<string, unknown>, b[key] as Record<string, unknown>)
  );
}

/**
 * Subscribe to one project's overlay maps. Returns an unsubscribe for all of them.
 *
 * Five listeners per project. Each fires independently, so `onUpdate` is called with a fresh whole
 * `ProjectOverlays` built from the latest value of every map — the caller gets a consistent object
 * rather than having to merge partial updates itself.
 *
 * Every listener returns `onValue`'s own unsubscribe rather than calling `off(path)`, which would
 * detach every listener registered at that path and so take down a second subscription to the same
 * project — the bug already fixed in `subscribeToSession` and `subscribeToSavedFiles`.
 */
export function subscribeToProjectOverlays(
  projectId: string,
  onUpdate: (overlays: ProjectOverlays) => void
): () => void {
  const current: ProjectOverlays = { ...EMPTY_OVERLAYS };

  const unsubscribes = OVERLAY_KEYS.map((key) =>
    onValue(ref(db, `sessions/${projectId}/${key}`), (snapshot) => {
      const val = snapshot.val() ?? {};
      // `projectAssignees` is keyed by TeamMember.id, which is a sanitized email and needs no
      // decoding. Every other map is keyed by an item or section id and does.
      const decoded = key === 'projectAssignees' ? val : decodeKeys(val);
      if (sameMap(current[key] as Record<string, unknown>, decoded)) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (current as any)[key] = decoded;
      onUpdate({ ...current });
    })
  );

  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}

/**
 * Bucket a project's items into the three workflow states.
 *
 * The bands are disjoint and sum to `itemCount`, which is what lets them be drawn as one wheel:
 *
 *   approved   — signed off by a human. Wins over everything else; an approved item is approved even
 *                if the AI originally left it blank.
 *   unanswered — the AI left it blank and no human has filled it in yet.
 *   ready      — everything else: answered, not signed off. This includes blanks a human has since
 *                filled, which is why `editedAnswers` is needed here.
 *
 * Ratings are not consulted. A five-star answer nobody has approved is still ready, and approval is
 * a separate, deliberate act — deriving it from stars would sign items off on the reviewer's behalf.
 */
export function computeProjectStats(
  meta: ProjectMeta,
  overlays: ProjectOverlays
): ProjectStats {
  const { itemCount, aiUnansweredIds } = meta;
  const { itemStatus, editedAnswers, ratings } = overlays;

  let approved = 0;
  for (const id of Object.keys(itemStatus)) {
    if (itemStatus[id] === 'approved') approved += 1;
  }

  let unanswered = 0;
  for (const id of aiUnansweredIds) {
    if (itemStatus[id] === 'approved') continue;
    if (editedAnswers[id] !== undefined) continue;
    unanswered += 1;
  }

  // Anything left over is ready. Clamped at zero because `itemCount` is denormalized metadata and an
  // `itemStatus` map holding ids from a document that has since changed would otherwise push this
  // negative and invert the wheel.
  const ready = Math.max(0, itemCount - approved - unanswered);

  return {
    itemCount,
    approved,
    ready,
    unanswered,
    approvedFraction: itemCount > 0 ? approved / itemCount : 0,
    complete: itemCount > 0 && approved === itemCount,
    editedCount: Object.keys(editedAnswers).length,
    ratedCount: Object.keys(ratings).length,
  };
}

/** A day, in ms. A due date is a calendar day, so it runs out at the end of that day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A project is overdue once its due date has passed and it is not fully approved.
 *
 * A due date is stored at UTC midnight *of* the due day, so the deadline is a full day later than the
 * stored instant: something due on 30 Sep is late on 1 Oct, not at one minute past midnight on the
 * 30th. Comparing against the stored instant directly flagged every project overdue a day early, for
 * the whole of the day it was actually due.
 *
 * Judged in UTC, matching how the date is stored and displayed, so a deadline falls at one moment for
 * the whole team rather than rolling across the dashboard with each reader's offset.
 */
export function isOverdue(meta: ProjectMeta, stats: ProjectStats, now = Date.now()): boolean {
  if (!meta.dueDate || stats.complete) return false;
  const due = Date.parse(meta.dueDate);
  return Number.isFinite(due) && due + DAY_MS <= now;
}

export function resolveMembers(ids: string[], teamMembers: TeamMember[]): TeamMember[] {
  return ids
    .map((id) => teamMembers.find((m) => m.id === id))
    .filter((m): m is TeamMember => m !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Owner ids for a project, as a plain array. */
export function ownerIdsOf(overlays: ProjectOverlays): string[] {
  return Object.keys(overlays.projectAssignees).filter((id) => overlays.projectAssignees[id]);
}

export interface AssignmentEntry {
  projectId: string;
  filename: string;
  /** Section keys assigned to this member in this project. */
  sections: string[];
  isOwner: boolean;
}

/**
 * What one person has been given to do, across every project.
 *
 * Works from overlays alone, so it costs no extra reads: sections come from `sectionAssignees` and
 * ownership from `projectAssignees`. Those are the only two things a member can be given — work is
 * handed out a section at a time, so there is no longer a per-item `assignees` map to enumerate.
 */
export function assignmentsForMember(
  memberId: string,
  projects: Array<{ meta: ProjectMeta; overlays: ProjectOverlays }>
): AssignmentEntry[] {
  const entries: AssignmentEntry[] = [];

  for (const { meta, overlays } of projects) {
    // Section keys are not all numeric, so `Number(a) - Number(b)` was NaN for most of them and the
    // order came out arbitrary. `parseQAFile` appends `.1`/`.2` to de-duplicated ids, `resolveSections`
    // emits `inferred:2` and `3~2` for inferred sections and split parts, and a producer's own ids look
    // like `A1.2`. Numeric collation orders all of those, and still puts 2 before 10.
    const sections = Object.keys(overlays.sectionAssignees)
      .filter((sectionKey) => overlays.sectionAssignees[sectionKey] === memberId)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const isOwner = overlays.projectAssignees[memberId] === true;

    if (sections.length === 0 && !isOwner) continue;

    entries.push({
      projectId: meta.id,
      filename: meta.filename,
      sections,
      isOwner,
    });
  }

  return entries.sort((a, b) => a.filename.localeCompare(b.filename));
}

/**
 * The three statuses, with their labels and CSS suffix, kept together so they cannot drift apart.
 *
 * **Order is outermost ring first.** `ProgressWheel` nests its rings in this order — approved on the
 * outside, unanswered at the centre — so reordering this array reorders the wheel.
 *
 * `short` is for the wheel's centre readout, which is only as wide as the innermost ring's clear space
 * and cannot hold "Ready for review".
 */
export const STATUS_BANDS: Array<{
  key: keyof Pick<ProjectStats, 'approved' | 'ready' | 'unanswered'>;
  label: string;
  short: string;
  modifier: string;
}> = [
  { key: 'approved', label: 'Approved', short: 'Approved', modifier: 'approved' },
  { key: 'ready', label: 'Ready for review', short: 'Ready', modifier: 'ready' },
  { key: 'unanswered', label: 'Unanswered', short: 'Unanswered', modifier: 'unanswered' },
];

export type { ItemStatus };
