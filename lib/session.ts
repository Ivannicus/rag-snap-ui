import { ref, set, update, remove, onValue, off, get } from 'firebase/database';
import { db } from './firebase';
import type { SessionState } from './types';

// Firebase RTDB forbids "." in keys. Encode/decode so item IDs like "1.1" survive round-trips.
function encodeKey(key: string): string {
  return key.replace(/\./g, '%2E');
}

function decodeKey(key: string): string {
  return key.replace(/%2E/g, '.');
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

export async function createSession(state: SessionState): Promise<string> {
  const sessionId = crypto.randomUUID();
  await set(ref(db, `sessions/${sessionId}`), {
    data: state.data,
    filename: state.filename,
    editedAnswers: encodeKeys(state.editedAnswers),
    ratings: encodeKeys(state.ratings),
    contextUrls: encodeKeys(state.contextUrls),
    assignees: encodeKeys(state.assignees),
    reviewers: encodeKeys(state.reviewers),
    createdAt: Date.now(),
  });
  return sessionId;
}

export function subscribeToSession(
  sessionId: string,
  onUpdate: (state: SessionState) => void
): () => void {
  const sessionRef = ref(db, `sessions/${sessionId}`);
  onValue(sessionRef, (snapshot) => {
    const val = snapshot.val();
    if (val) {
      onUpdate({
        data: val.data,
        filename: val.filename ?? '',
        editedAnswers: decodeKeys(val.editedAnswers ?? {}),
        ratings: decodeKeys(val.ratings ?? {}),
        contextUrls: decodeKeys(val.contextUrls ?? {}),
        assignees: decodeKeys(val.assignees ?? {}),
        reviewers: decodeKeys(val.reviewers ?? {}),
      });
    }
  });
  return () => off(sessionRef);
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

export function updateAssignee(sessionId: string, itemId: string, memberId: string) {
  return update(ref(db, `sessions/${sessionId}/assignees`), { [encodeKey(itemId)]: memberId });
}

export function clearAssignee(sessionId: string, itemId: string) {
  return remove(ref(db, `sessions/${sessionId}/assignees/${encodeKey(itemId)}`));
}

export function updateReviewer(sessionId: string, itemId: string, memberId: string) {
  return update(ref(db, `sessions/${sessionId}/reviewers`), { [encodeKey(itemId)]: memberId });
}

export function clearReviewer(sessionId: string, itemId: string) {
  return remove(ref(db, `sessions/${sessionId}/reviewers/${encodeKey(itemId)}`));
}

/**
 * When a team member is deleted from the bank, revert any assignee/reviewer
 * references to that member back to unassigned across all active sessions.
 */
export async function revertAssignmentsForMember(memberId: string): Promise<void> {
  const snapshot = await get(ref(db, 'sessions'));
  const sessions = snapshot.val();
  if (!sessions) return;

  const updates: Record<string, null> = {};
  for (const [sessionId, session] of Object.entries(sessions as Record<string, any>)) {
    for (const [itemId, assigneeId] of Object.entries(session.assignees ?? {})) {
      if (assigneeId === memberId) {
        updates[`sessions/${sessionId}/assignees/${itemId}`] = null;
      }
    }
    for (const [itemId, reviewerId] of Object.entries(session.reviewers ?? {})) {
      if (reviewerId === memberId) {
        updates[`sessions/${sessionId}/reviewers/${itemId}`] = null;
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    await update(ref(db), updates);
  }
}
