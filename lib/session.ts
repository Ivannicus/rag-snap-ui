import { ref, update, remove, onValue, get, runTransaction } from 'firebase/database';
import { db } from './firebase';
import type { ItemStatus, ParsedQAFile, SessionState } from './types';

/**
 * Firebase RTDB forbids "." in keys. Encode/decode so item IDs like "1.1" survive round-trips.
 *
 * Exported because section keys are derived from item ids (`sectionOf` splits on ".") and so carry
 * the same restriction, and because the dashboard reads these maps through its own module. One
 * codec for every key under a session node — a second, parallel implementation is how the two halves
 * of a map end up disagreeing about what a key is called.
 */
export function encodeKey(key: string): string {
  return key.replace(/\./g, '%2E');
}

export function decodeKey(key: string): string {
  return key.replace(/%2E/g, '.');
}

function encodeKeys<T>(map: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(map)) out[encodeKey(k)] = v;
  return out;
}

export function decodeKeys<T>(map: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(map)) out[decodeKey(k)] = v;
  return out;
}

/**
 * A session for a document nobody has touched yet: the results plus empty overlay maps.
 *
 * One place to build this, so that adding an overlay map cannot leave a caller seeding a session that
 * is missing it. Both callers — opening a document, and receiving a handed-off batch — used to spell
 * the literal out themselves.
 */
export function newSessionState(data: ParsedQAFile, filename: string): SessionState {
  return {
    data,
    filename,
    editedAnswers: {},
    ratings: {},
    contextUrls: {},
    itemStatus: {},
    projectAssignees: {},
    sectionAssignees: {},
    sectionReviewers: {},
  };
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
      itemStatus: encodeKeys(state.itemStatus),
      sectionAssignees: encodeKeys(state.sectionAssignees),
      sectionReviewers: encodeKeys(state.sectionReviewers),
      // Keyed by TeamMember.id, which is a sanitized email and already free of forbidden characters,
      // so this map is the one that is stored as-is.
      projectAssignees: state.projectAssignees,
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
        // Every session node written before these fields existed lacks them, so each defaults to an
        // empty map rather than being trusted to be present. Nodes written *before* per-item
        // assignment was removed still carry `assignees`/`reviewers`; they are simply not read.
        itemStatus: decodeKeys(val.itemStatus ?? {}),
        sectionAssignees: decodeKeys(val.sectionAssignees ?? {}),
        sectionReviewers: decodeKeys(val.sectionReviewers ?? {}),
        projectAssignees: val.projectAssignees ?? {},
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

export function updateItemStatus(sessionId: string, itemId: string, status: ItemStatus) {
  return update(ref(db, `sessions/${sessionId}/itemStatus`), { [encodeKey(itemId)]: status });
}

/** Withdraw a sign-off. The item falls back to ready, or to unanswered if the AI left it blank. */
export function clearItemStatus(sessionId: string, itemId: string) {
  return remove(ref(db, `sessions/${sessionId}/itemStatus/${encodeKey(itemId)}`));
}

export function updateSectionAssignee(sessionId: string, sectionKey: string, memberId: string) {
  return update(ref(db, `sessions/${sessionId}/sectionAssignees`), {
    [encodeKey(sectionKey)]: memberId,
  });
}

export function clearSectionAssignee(sessionId: string, sectionKey: string) {
  return remove(ref(db, `sessions/${sessionId}/sectionAssignees/${encodeKey(sectionKey)}`));
}

export function updateSectionReviewer(sessionId: string, sectionKey: string, memberId: string) {
  return update(ref(db, `sessions/${sessionId}/sectionReviewers`), {
    [encodeKey(sectionKey)]: memberId,
  });
}

export function clearSectionReviewer(sessionId: string, sectionKey: string) {
  return remove(ref(db, `sessions/${sessionId}/sectionReviewers/${encodeKey(sectionKey)}`));
}

/**
 * Replace a project's owners with exactly `memberIds`.
 *
 * Written as one `update` of member-id keys rather than a `set` of the whole map, so that two leads
 * editing different owners at the same moment do not overwrite each other: every key either present
 * or explicitly `null` means the write says something definite about each owner it changes, and
 * nothing at all about any key added between the read and the write.
 */
export function setProjectAssignees(
  sessionId: string,
  memberIds: string[],
  previousMemberIds: string[]
) {
  const patch: Record<string, true | null> = {};
  for (const id of previousMemberIds) patch[id] = null;
  for (const id of memberIds) patch[id] = true;
  return update(ref(db, `sessions/${sessionId}/projectAssignees`), patch);
}

/**
 * When a team member is deleted from the bank, revert every reference to that member back to
 * unassigned across all active sessions.
 *
 * Covers all three places a `TeamMember.id` can appear: the per-section `sectionAssignees` and
 * `sectionReviewers`, and `projectAssignees` — which is the one keyed *by* member id rather than
 * holding it as a value, so it is matched on the key instead.
 *
 * Sessions opened before per-item assignment was removed can still hold `assignees`/`reviewers`
 * nodes naming this member. They are left alone: nothing reads them any more, so a stale id in
 * there is invisible rather than a ghost assignment.
 *
 * `itemStatus` is deliberately not touched. It holds only the literal "approved" and never a member
 * id, so there is no ghost reference in it to clear, and clearing it anyway would silently withdraw
 * sign-offs across every project because one person left the team. Revoking a departed member's
 * approvals is a defensible rule, but it needs the approver recorded alongside the status before it
 * can be done to the right items rather than to all of them.
 */
export async function revertAssignmentsForMember(memberId: string): Promise<void> {
  const snapshot = await get(ref(db, 'sessions'));
  const sessions = snapshot.val();
  if (!sessions) return;

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
    if (session.projectAssignees?.[memberId]) {
      updates[`sessions/${sessionId}/projectAssignees/${memberId}`] = null;
    }
  }

  if (Object.keys(updates).length > 0) {
    await update(ref(db), updates);
  }
}
