import { ref, update, remove, onValue, get, runTransaction } from 'firebase/database';
import { db } from './firebase';
import type { SessionState } from './types';

// Firebase RTDB forbids ".", "$", "#", "[", "]" and "/" in keys. Item IDs like "1.1" and section
// keys taken from producer-supplied labels ("Security/Compliance") can contain any of them, and an
// unescaped "/" is the dangerous one: RTDB reads it as a path separator and silently nests the
// value instead of rejecting it. "%" is escaped first and unescaped last so the mapping is
// reversible even for a key that already contains a percent sequence.
const KEY_ESCAPES: Array<[string, string]> = [
  ['%', '%25'],
  ['.', '%2E'],
  ['$', '%24'],
  ['#', '%23'],
  ['[', '%5B'],
  [']', '%5D'],
  ['/', '%2F'],
];

function encodeKey(key: string): string {
  return KEY_ESCAPES.reduce((acc, [ch, esc]) => acc.split(ch).join(esc), key);
}

function decodeKey(key: string): string {
  return [...KEY_ESCAPES]
    .reverse()
    .reduce((acc, [ch, esc]) => acc.split(esc).join(ch), key);
}

function encodeKeys<T>(map: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(map)) out[encodeKey(k)] = v;
  return out;
}

function decodeKeys<T>(map: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(map)) out[decodeKey(k)] = v;
  return out;
}

/**
 * Create the session node for a doc if it does not exist yet.
 *
 * The session id is the doc's saved-file id, so opening the same doc always lands in the same room.
 * That makes this idempotent by design: the first tab to open a doc seeds the node, and every later
 * open is a no-op that leaves the existing overlays alone.
 *
 * The seed runs as a transaction rather than a read followed by a write, because the two are not the
 * same thing under concurrency. Two people opening a doc at the same moment both saw the node
 * missing, and both then wrote the whole node, so the second write replaced the first — taking with
 * it any overlay the first person had already made in the gap. A transaction re-runs its handler
 * against the server's current value, so exactly one seed lands and any node that already exists is
 * left completely alone.
 */
export async function ensureSession(sessionId: string, state: SessionState): Promise<void> {
  const sessionRef = ref(db, `sessions/${sessionId}`);
  // Fixed outside the handler: the handler can run more than once, and the node's creation time
  // should not depend on how many attempts contention happened to cost.
  const createdAt = Date.now();

  await runTransaction(sessionRef, (current) => {
    // `undefined` aborts the transaction without writing. The node is already seeded, which is the
    // ordinary case for every open after the first, so there is nothing to do and nothing to report.
    if (current !== null) return undefined;

    return {
      data: state.data,
      filename: state.filename,
      editedAnswers: encodeKeys(state.editedAnswers),
      ratings: encodeKeys(state.ratings),
      contextUrls: encodeKeys(state.contextUrls),
      approvals: encodeKeys(state.approvals),
      sectionAssignees: encodeKeys(state.sectionAssignees),
      sectionReviewers: encodeKeys(state.sectionReviewers),
      createdAt,
    };
  });
}

export function subscribeToSession(
  sessionId: string,
  onUpdate: (state: SessionState) => void
): () => void {
  const sessionRef = ref(db, `sessions/${sessionId}`);
  // onValue's own return value detaches exactly this callback. The previous `off(sessionRef)`
  // detached every listener registered at the path, so two overlapping subscriptions to one doc
  // (a React strict-mode double mount, say) would take each other down.
  return onValue(sessionRef, (snapshot) => {
    const val = snapshot.val();
    if (val) {
      onUpdate({
        data: val.data,
        filename: val.filename ?? '',
        editedAnswers: decodeKeys(val.editedAnswers ?? {}),
        ratings: decodeKeys(val.ratings ?? {}),
        contextUrls: decodeKeys(val.contextUrls ?? {}),
        // A session written before approval existed has no node here, so it opens with everything
        // ready and nothing approved — which is exactly the right starting point.
        approvals: decodeKeys(val.approvals ?? {}),
        // Only the section-keyed nodes are read. A session written before assignment moved from
        // questions to sections still holds item-keyed assignees/reviewers; those are obsolete and
        // left untouched rather than migrated, so such a session opens with every section
        // unassigned.
        sectionAssignees: decodeKeys(val.sectionAssignees ?? {}),
        sectionReviewers: decodeKeys(val.sectionReviewers ?? {}),
      });
    }
  });
}

export function updateAnswer(sessionId: string, itemId: string, answer: string) {
  return update(ref(db, `sessions/${sessionId}/editedAnswers`), { [encodeKey(itemId)]: answer });
}

export function clearAnswer(sessionId: string, itemId: string) {
  return remove(ref(db, `sessions/${sessionId}/editedAnswers/${encodeKey(itemId)}`));
}

export function updateRating(sessionId: string, itemId: string, rating: number) {
  return update(ref(db, `sessions/${sessionId}/ratings`), { [encodeKey(itemId)]: rating });
}

export function clearRating(sessionId: string, itemId: string) {
  return remove(ref(db, `sessions/${sessionId}/ratings/${encodeKey(itemId)}`));
}

export function updateContextUrl(sessionId: string, itemId: string, url: string) {
  return update(ref(db, `sessions/${sessionId}/contextUrls`), { [encodeKey(itemId)]: url });
}

export function clearContextUrl(sessionId: string, itemId: string) {
  return remove(ref(db, `sessions/${sessionId}/contextUrls/${encodeKey(itemId)}`));
}

/**
 * Approve one question. Writes `true`; un-approving removes the key rather than writing `false`, so
 * the node only ever holds the questions that are actually approved.
 */
export function updateApproval(sessionId: string, itemId: string) {
  return update(ref(db, `sessions/${sessionId}/approvals`), { [encodeKey(itemId)]: true });
}

export function clearApproval(sessionId: string, itemId: string) {
  return remove(ref(db, `sessions/${sessionId}/approvals/${encodeKey(itemId)}`));
}

export function updateAssignee(sessionId: string, sectionKey: string, memberId: string) {
  return update(ref(db, `sessions/${sessionId}/sectionAssignees`), {
    [encodeKey(sectionKey)]: memberId,
  });
}

export function clearAssignee(sessionId: string, sectionKey: string) {
  return remove(ref(db, `sessions/${sessionId}/sectionAssignees/${encodeKey(sectionKey)}`));
}

export function updateReviewer(sessionId: string, sectionKey: string, memberId: string) {
  return update(ref(db, `sessions/${sessionId}/sectionReviewers`), {
    [encodeKey(sectionKey)]: memberId,
  });
}

export function clearReviewer(sessionId: string, sectionKey: string) {
  return remove(ref(db, `sessions/${sessionId}/sectionReviewers/${encodeKey(sectionKey)}`));
}

/**
 * When a team member is deleted from the bank, revert any assignee/reviewer
 * references to that member back to unassigned across all active sessions.
 */
export async function revertAssignmentsForMember(memberId: string): Promise<void> {
  const snapshot = await get(ref(db, 'sessions'));
  const sessions = snapshot.val();
  if (!sessions) return;

  // Keys are already in their encoded form here, having come straight back from RTDB, so they are
  // spliced into the paths as-is.
  const updates: Record<string, null> = {};
  for (const [sessionId, session] of Object.entries(sessions as Record<string, any>)) {
    for (const [sectionKey, assigneeId] of Object.entries(session.sectionAssignees ?? {})) {
      if (assigneeId === memberId) {
        updates[`sessions/${sessionId}/sectionAssignees/${sectionKey}`] = null;
      }
    }
    for (const [sectionKey, reviewerId] of Object.entries(session.sectionReviewers ?? {})) {
      if (reviewerId === memberId) {
        updates[`sessions/${sessionId}/sectionReviewers/${sectionKey}`] = null;
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    await update(ref(db), updates);
  }
}
