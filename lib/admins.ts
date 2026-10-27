import { ref, onValue, set, update } from 'firebase/database';
import { db } from './firebase';
import { revertAssignmentsForMember } from './session';

/**
 * Admin power: who may run the app's destructive and administrative actions.
 *
 *   admins/<TeamMember.id> -> { grantedAt, grantedBy, grantedByEmail }
 *
 * Keyed by `TeamMember.id`, the sanitized email, so "is this person an admin" is one lookup against an
 * id every view already holds. The grant records who gave it and when, so the Admin tab can say how
 * someone came to hold it — a bare `true` would leave that unanswerable.
 *
 * ## Enforced, unlike the app's other gates
 *
 * The approve gate and the owner gate are UI restrictions only (see CLAUDE.md). This one is also in
 * `database.rules.json`: only an admin can write `/admins`, remove somebody else from `/teamMembers`,
 * or delete a `/savedFiles` record they did not upload. The rule can derive the caller's key from
 * `auth.token.email`, which is what the other two would have needed and could not get.
 *
 * ## No self-service bootstrap
 *
 * Only admins can grant admin, and the Admin tab is visible to admins alone, so there is no in-app way
 * to become the first one. If `/admins` is ever empty, seed it from the Firebase CLI, which bypasses the
 * rules:
 *
 *   firebase database:set /admins/<TeamMember.id> grant.json --project canonical-req-8605
 *
 * The Admin tab refuses to let the last admin revoke themselves, so this should only be needed after a
 * manual edit in the console.
 */
export interface AdminGrant {
  grantedAt: number;
  grantedBy: string;
  grantedByEmail: string;
}

/** The hover text on every control a non-admin is shown but cannot use, outside the Admin tab. */
export const ADMIN_ONLY_HINT = "Requires admin privileges";

interface Granter {
  name: string;
  email: string;
}

/**
 * Live map of every admin grant, keyed by `TeamMember.id`.
 *
 * `onError` fires when the read is refused, which is what happens until the rules that introduce
 * `/admins` are deployed: RTDB denies a path no rule mentions. Everyone is then treated as a non-admin,
 * which fails closed.
 */
export function subscribeToAdmins(
  onUpdate: (admins: Record<string, AdminGrant>) => void,
  onError?: (error: Error) => void
): () => void {
  // onValue's own unsubscribe, never `off(path)` — see `subscribeToTeamMembers`.
  return onValue(
    ref(db, 'admins'),
    (snapshot) => {
      const val = snapshot.val() as Record<string, Partial<AdminGrant>> | null;
      const admins: Record<string, AdminGrant> = {};
      for (const [id, grant] of Object.entries(val ?? {})) {
        admins[id] = {
          grantedAt: grant.grantedAt ?? 0,
          grantedBy: grant.grantedBy ?? 'Unknown',
          grantedByEmail: grant.grantedByEmail ?? '',
        };
      }
      onUpdate(admins);
    },
    onError
  );
}

export function grantAdmin(memberId: string, by: Granter): Promise<void> {
  return set(ref(db, `admins/${memberId}`), {
    grantedAt: Date.now(),
    grantedBy: by.name,
    grantedByEmail: by.email,
  });
}

export function revokeAdmin(memberId: string): Promise<void> {
  return set(ref(db, `admins/${memberId}`), null);
}

/**
 * Take somebody out of the tool: their team-bank entry and any admin grant go together, then every
 * section naming them reverts to Unassigned.
 *
 * The admin grant goes with the entry because it is keyed by the same id, and `ensureTeamMember` writes
 * that id straight back when they next sign in — a grant left behind would hand a removed person their
 * admin power back on arrival. One multi-path `update`, so neither half can land without the other.
 *
 * Throws only if that removal is refused. Clearing their assignments is a separate scan of every room
 * and can fail on its own after the removal has landed, so it is reported in the result instead —
 * "was not removed" would be untrue by then.
 */
export async function removeUserFromTool(memberId: string): Promise<{ assignmentsCleared: boolean }> {
  await update(ref(db), {
    [`teamMembers/${memberId}`]: null,
    [`admins/${memberId}`]: null,
  });
  try {
    await revertAssignmentsForMember(memberId);
    return { assignmentsCleared: true };
  } catch {
    return { assignmentsCleared: false };
  }
}
