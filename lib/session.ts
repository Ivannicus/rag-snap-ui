import { ref, set, update, remove, onValue, off } from 'firebase/database';
import { db } from './firebase';
import type { SessionState } from './types';

export async function createSession(state: SessionState): Promise<string> {
  const sessionId = crypto.randomUUID();
  await set(ref(db, `sessions/${sessionId}`), {
    data: state.data,
    filename: state.filename,
    editedAnswers: state.editedAnswers,
    ratings: state.ratings,
    contextUrls: state.contextUrls,
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
        editedAnswers: val.editedAnswers ?? {},
        ratings: val.ratings ?? {},
        contextUrls: val.contextUrls ?? {},
      });
    }
  });
  return () => off(sessionRef);
}

export function updateAnswer(sessionId: string, itemId: string, answer: string) {
  return update(ref(db, `sessions/${sessionId}/editedAnswers`), { [itemId]: answer });
}

export function clearAnswer(sessionId: string, itemId: string) {
  return remove(ref(db, `sessions/${sessionId}/editedAnswers/${itemId}`));
}

export function updateRating(sessionId: string, itemId: string, rating: number) {
  return update(ref(db, `sessions/${sessionId}/ratings`), { [itemId]: rating });
}

export function clearRating(sessionId: string, itemId: string) {
  return remove(ref(db, `sessions/${sessionId}/ratings/${itemId}`));
}

export function updateContextUrl(sessionId: string, itemId: string, url: string) {
  return update(ref(db, `sessions/${sessionId}/contextUrls`), { [itemId]: url });
}

export function clearContextUrl(sessionId: string, itemId: string) {
  return remove(ref(db, `sessions/${sessionId}/contextUrls/${itemId}`));
}
