import { ref, get, set, remove, onValue, off } from 'firebase/database';
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
  onValue(teamRef, (snapshot) => {
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
  return () => off(teamRef);
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
