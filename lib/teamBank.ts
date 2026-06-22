import { ref, push, set, remove, onValue, off } from 'firebase/database';
import { db } from './firebase';
import type { TeamMember } from './types';

export function subscribeToTeamMembers(
  onUpdate: (members: TeamMember[]) => void
): () => void {
  const teamRef = ref(db, 'teamMembers');
  onValue(teamRef, (snapshot) => {
    const val = snapshot.val();
    const members: TeamMember[] = val
      ? Object.entries(val as Record<string, { name: string }>)
          .map(([id, v]) => ({ id, name: v.name }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];
    onUpdate(members);
  });
  return () => off(teamRef);
}

export async function addTeamMember(name: string): Promise<string> {
  const newRef = push(ref(db, 'teamMembers'));
  await set(newRef, { name, createdAt: Date.now() });
  return newRef.key as string;
}

export function removeTeamMember(memberId: string): Promise<void> {
  return remove(ref(db, `teamMembers/${memberId}`));
}
