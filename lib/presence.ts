import { ref, set, remove, onValue, onDisconnect, runTransaction, serverTimestamp } from 'firebase/database';
import { db } from './firebase';
import { decodeKey, encodeKey } from './session';

/**
 * Live presence: who has which question's editor open right now — and, because only one person may,
 * the lock on it. Nothing here streams keystrokes or touches an answer.
 *
 *   presence/<sessionId>/<encodeKey(questionId)>/<tabId> = { memberId, name, photoURL, ts }
 *
 * A top-level sibling of `/sessions`, not a child of it. `subscribeToSession` is an `onValue` on the
 * whole `sessions/<id>` node, so a heartbeat under it would re-deliver the entire room every 15s; and
 * `ensureSession`'s seed transaction aborts when `sessions/<id>` already exists, so a presence write
 * landing before the seed would leave the room with no document. The same split as `/savedFileData`.
 *
 * Keyed by **tab**, not by person. Keyed by `memberId`, the same user's second tab or device found its
 * own entry already there, treated it as its own lock and walked straight in, so two drafts of one answer
 * could again overwrite each other — and cancelling in either tab removed the entry the other was still
 * relying on. Each page load now has its own `tabId`, and another tab of yours is just another holder.
 * `memberId` rides inside the entry so the UI can still say "you, in another tab". Entries written by a
 * build that keyed on `memberId` carry no `memberId` child and are read with the key as the member; the
 * two shapes still exclude each other, since neither's key can match the other's.
 *
 * Tab ids and `memberId`s (sanitized emails) need no encoding. Question ids do.
 *
 * Every failure is swallowed. Presence is throwaway, and until `/presence` has a deployed rule every
 * write is rejected — that must leave the feature invisible, not raise the "may not have saved" toast.
 * The lock fails *open* for the same reason (see `claimEditing`): an undeployed rule must not leave
 * every editor in the app refusing to open.
 */

/** One heartbeat per open editor per 15s — in a visible tab. */
export const HEARTBEAT_MS = 15_000;
/**
 * How long an entry outlives its last heartbeat. Sized for a *background* tab, not a visible one: Chrome
 * aligns the timers of a tab hidden for five minutes to once a minute, so a draft left open behind
 * another window beats every ~60s however short `HEARTBEAT_MS` is. At the old 35s that lock lapsed for
 * part of every minute and anyone could claim the question out from under the draft. 90s is that minute
 * plus room for a slow write. The cost falls only on a tab whose network died: a closed or crashed tab
 * is still released at once by `onDisconnect`, but a dead connection now holds its lock for up to 90s.
 *
 * What this cannot cover is a tab the browser *freezes* outright (Chrome's tab freezing, a laptop
 * asleep): no JavaScript runs at all, so the lock lapses after 90s and whoever is in first gets it.
 */
export const STALE_MS = 90_000;
/** How often staleness is re-checked between snapshots, while anyone is shown as editing. */
export const SWEEP_MS = 5_000;

export interface PresenceUser {
  memberId: string;
  name: string;
  photoURL: string | null;
}

/** Somebody with a question's editor open, in one particular tab. */
export interface PresenceEditor extends PresenceUser {
  tabId: string;
}

interface PresenceEntry extends PresenceEditor {
  /** Server time of the last heartbeat. */
  ts: number;
}

/** questionId (decoded) → everyone with a heartbeat on it, stale or not. */
export type PresenceSnapshot = Record<string, PresenceEntry[]>;

/** questionId → the live editors on it. Questions nobody is editing are absent. */
export type PresenceMap = Record<string, PresenceEditor[]>;

let tabId: string | null = null;

/**
 * This page load's id, made on first use. A fresh one per load rather than anything stored: a reload is
 * a new tab as far as the lock is concerned, and the old load's entry is removed by its `onDisconnect`.
 * Base 36 only, so it is a valid RTDB key as it stands.
 */
export function thisTabId(): string {
  if (!tabId) tabId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return tabId;
}

/**
 * Client clock minus server clock, from `.info/serverTimeOffset`. Timestamps are written with
 * `serverTimestamp()`, so staleness has to be judged on server time too — otherwise two laptops a couple
 * of minutes apart, normal after a sleep, would see a permanent ghost or a presence that never shows.
 * `.info/*` is computed locally by the SDK, so the listener costs no bandwidth and is left open.
 */
let serverTimeOffset = 0;
let offsetWatched = false;

function watchServerTimeOffset() {
  if (offsetWatched) return;
  offsetWatched = true;
  onValue(ref(db, '.info/serverTimeOffset'), (snapshot) => {
    serverTimeOffset = typeof snapshot.val() === 'number' ? snapshot.val() : 0;
  });
}

/** Now, on the server's clock. */
export function serverNow(): number {
  return Date.now() + serverTimeOffset;
}

/**
 * Take the lock on `questionId`'s editor, atomically: true when this tab now holds it, false when
 * somebody else — or this same user in another tab — already has it open.
 *
 * A transaction rather than a read of the live map, because two people clicking Edit within the same
 * moment would each see the other absent and both get in. Here the second commit retries against the
 * first one's entry and aborts. Stale entries — a tab that died without `onDisconnect` reaching the
 * server — do not hold the lock, and are dropped on the way through.
 *
 * Fails open: if the transaction itself errors (no deployed rule, no access) this returns true, and
 * editing behaves as it did before there was a lock.
 */
export async function claimEditing(sessionId: string, questionId: string, me: PresenceUser): Promise<boolean> {
  watchServerTimeOffset();
  const node = ref(db, `presence/${sessionId}/${encodeKey(questionId)}`);
  const tab = thisTabId();
  try {
    const result = await runTransaction(node, (current: Record<string, { ts?: unknown }> | null) => {
      const now = serverNow();
      const kept: Record<string, unknown> = {};
      for (const [holder, value] of Object.entries(current ?? {})) {
        if (holder === tab) continue;
        const ts = value?.ts;
        if (typeof ts === 'number' && now - ts >= STALE_MS) continue; // stale: drop it
        // Live, or a placeholder not yet resolved by the server: another tab is in. Abort.
        return;
      }
      kept[tab] = { memberId: me.memberId, name: me.name, photoURL: me.photoURL, ts: serverTimestamp() };
      return kept;
    });
    return result.committed;
  } catch {
    return true;
  }
}

/**
 * Give back a lock this tab claimed but never went on to publish — the question was approved, or its
 * card went away, while the claim was in flight. Without it the claim sits there, unrenewed but unexpired,
 * and locks everybody else out for `STALE_MS`. Removes only this tab's entry.
 */
export function releaseEditing(sessionId: string, questionId: string): void {
  remove(ref(db, `presence/${sessionId}/${encodeKey(questionId)}/${thisTabId()}`)).catch(() => {});
}

/**
 * Mark this tab as editing `questionId` until the returned teardown runs. Called once the lock is held, for
 * as long as the editor stays open; the teardown is what releases it.
 *
 * `onDisconnect().remove()` is what cleans up a closed or crashed tab server-side. It is re-registered
 * on every beat, not once: a dropped connection fires it and spends it, and the heartbeat that lands
 * after the reconnect would otherwise leave a node with nothing left to remove it.
 */
export function publishPresence(sessionId: string, questionId: string, me: PresenceUser): () => void {
  watchServerTimeOffset();
  const node = ref(db, `presence/${sessionId}/${encodeKey(questionId)}/${thisTabId()}`);
  const disconnect = onDisconnect(node);

  const beat = () => {
    disconnect.remove().catch(() => {});
    set(node, {
      memberId: me.memberId,
      name: me.name,
      photoURL: me.photoURL,
      ts: serverTimestamp(),
    }).catch(() => {});
  };
  beat();
  const interval = setInterval(beat, HEARTBEAT_MS);
  // Beat as soon as the tab comes back to the front, rather than waiting out a throttled interval.
  const onVisible = () => {
    if (document.visibilityState === 'visible') beat();
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    clearInterval(interval);
    document.removeEventListener('visibilitychange', onVisible);
    disconnect.cancel().catch(() => {});
    remove(node).catch(() => {});
  };
}

/**
 * Everyone with a presence node in this session, stale entries included — staleness depends on when you
 * ask, so it is `livePresence`'s job. Returns `onValue`'s own unsubscribe, never `off(path)`.
 */
export function subscribeToPresence(
  sessionId: string,
  onUpdate: (snapshot: PresenceSnapshot) => void
): () => void {
  watchServerTimeOffset();
  return onValue(
    ref(db, `presence/${sessionId}`),
    (snapshot) => {
      const raw = (snapshot.val() ?? {}) as Record<
        string,
        Record<string, { memberId?: string; name?: string; photoURL?: string | null; ts?: unknown }> | null
      >;
      const out: PresenceSnapshot = {};
      for (const [questionKey, holders] of Object.entries(raw)) {
        const entries: PresenceEntry[] = [];
        for (const [holder, value] of Object.entries(holders ?? {})) {
          // `ts` is a placeholder object until the server resolves it; skip until it is a number.
          if (typeof value?.ts !== 'number') continue;
          // An entry from a build that keyed by member has no `memberId` child; its key is the member.
          const memberId = value.memberId || holder;
          entries.push({
            tabId: holder,
            memberId,
            name: value.name || memberId,
            photoURL: value.photoURL ?? null,
            ts: value.ts,
          });
        }
        if (entries.length) out[decodeKey(questionKey)] = entries;
      }
      onUpdate(out);
    },
    // Rule not deployed yet, or access lost: nobody is shown as editing.
    () => onUpdate({})
  );
}

/** The editors in `snapshot` whose last heartbeat is within `STALE_MS` of `now` (server time). */
export function livePresence(snapshot: PresenceSnapshot, now: number): PresenceMap {
  const out: PresenceMap = {};
  for (const [questionId, entries] of Object.entries(snapshot)) {
    const live = entries
      .filter((entry) => now - entry.ts < STALE_MS)
      .map(({ tabId, memberId, name, photoURL }) => ({ tabId, memberId, name, photoURL }));
    if (live.length) out[questionId] = live;
  }
  return out;
}

/**
 * Whether two maps show the same people on the same questions. A heartbeat changes only `ts`, so
 * without this every beat from every editor would re-render the whole inspector — nothing in that tree
 * is memoized.
 */
export function samePresence(a: PresenceMap, b: PresenceMap): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => {
    const x = a[key];
    const y = b[key];
    return (
      y !== undefined &&
      x.length === y.length &&
      x.every(
        (u, i) =>
          u.tabId === y[i].tabId &&
          u.memberId === y[i].memberId &&
          u.name === y[i].name &&
          u.photoURL === y[i].photoURL
      )
    );
  });
}
