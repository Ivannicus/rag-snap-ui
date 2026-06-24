import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { auth } from './firebase';
import { ensureTeamMember } from './teamBank';

const provider = new GoogleAuthProvider();
// Pre-selects @canonical.com accounts in the Google picker
provider.setCustomParameters({ hd: 'canonical.com' });

export async function signInWithGoogle(): Promise<void> {
  const result = await signInWithPopup(auth, provider);
  const email = result.user.email ?? '';
  if (!email.endsWith('@canonical.com')) {
    await signOut(auth);
    throw new Error('Access restricted to @canonical.com accounts.');
  }
  await ensureTeamMember({
    name: result.user.displayName ?? email,
    email,
    photoURL: result.user.photoURL ?? undefined,
  });
}

export function signOutUser() {
  return signOut(auth);
}
