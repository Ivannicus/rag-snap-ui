import { ref, get, set, remove, onValue } from 'firebase/database';
import { db } from './firebase';
import type { TeamMember } from './types';

// Firebase RTDB keys can't contain '.', '#', '$', '[', ']', or '/'.
function sanitizeEmailKey(email: string): string {
  return email.replace(/[.#$/[\]]/g, '_');
}

export function subscribeToTeamMembers(
  onUpdate: (members: TeamMember[]) => void
): () => void {
  const teamRef = ref(db, 'teamMembers');
  // Returns onValue's own unsubscribe, which detaches exactly this callback. The previous
  // `off(teamRef)` detached every listener registered at the path, so two overlapping subscriptions
  // would take each other down and leave the team list frozen. Same fix as `subscribeToSession` and
  // `subscribeToSavedFiles`.
  return onValue(teamRef, (snapshot) => {
    const val = snapshot.val();
    const members: TeamMember[] = val
      ? Object.entries(
          val as Record<string, { name: string; email?: string; photoURL?: string }>
        )
          .map(([id, v]) => ({
            id,
            name: v.name,
            email: v.email ?? '',
            photoURL: v.photoURL ?? undefined,
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];
    onUpdate(members);
  });
}

interface EnsureTeamMemberInput {
  name: string;
  email: string;
  photoURL?: string;
}

// Writes a team member once, on their first sign-in, keyed by their email.
// No-ops if that email is already in the bank.
export async function ensureTeamMember({
  name,
  email,
  photoURL,
}: EnsureTeamMemberInput): Promise<void> {
  const memberRef = ref(db, `teamMembers/${sanitizeEmailKey(email)}`);
  const snapshot = await get(memberRef);
  if (snapshot.exists()) return;
  await set(memberRef, { name, email, photoURL: photoURL ?? null, createdAt: Date.now() });
}

export function removeTeamMember(memberId: string): Promise<void> {
  return remove(ref(db, `teamMembers/${memberId}`));
}

/**
 * Resolve the signed-in user to their team-bank entry, or null when the bank does not hold them.
 *
 * The one implementation of "which member am I". `AppShell` needs it to know who may approve a
 * section, and the dashboard needs it to know whose assignments to list; both used to carry their own
 * copy of this `find`, which is two places for the answer to drift.
 *
 * Matched on email rather than by sanitizing the address into a key here. `sanitizeEmailKey` above is
 * private on purpose — a second caller of it would be a second copy of the codec, and worse, it would
 * mint an id for somebody the bank has no record of, which every consumer would then look up and find
 * nothing for.
 *
 * Three things this is careful about, each of which has a wrong answer that looks plausible:
 *
 * - **An empty address matches nobody.** `subscribeToTeamMembers` normalizes a record with no `email`
 *   child to `''`, and `AuthGate` passes `user.email ?? ""`. A bare `===` would therefore pair a user
 *   whose account carries no address with whichever bank record happens to be missing one, and show
 *   them a stranger's assignments. Both sides have to be non-empty to match at all.
 * - **Exact case wins over a case-insensitive match.** The bank is keyed by the sanitized address, so
 *   `Alice@canonical.com` and `alice@canonical.com` are two different keys and two different ids, and
 *   `ensureTeamMember` writes whatever the provider returned. Where both exist, a plain
 *   case-insensitive `find` returns whichever RTDB happened to enumerate first — and assignments
 *   recorded against the other id would silently not show. Preferring the exact match makes it the
 *   same answer every time.
 * - **Whitespace is trimmed** on both sides, so an address stored with a stray space is still found.
 */
export function findMemberByEmail(
  members: TeamMember[],
  email: string | null | undefined
): TeamMember | null {
  const raw = (email ?? '').trim();
  if (!raw) return null;
  const wanted = raw.toLowerCase();

  let looseMatch: TeamMember | null = null;
  for (const member of members) {
    const candidate = (member.email ?? '').trim();
    if (!candidate) continue;
    if (candidate === raw) return member;
    if (looseMatch === null && candidate.toLowerCase() === wanted) looseMatch = member;
  }
  return looseMatch;
}
