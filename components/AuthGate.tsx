"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { signOutUser } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import LoginScreen from "@/components/LoginScreen";

export default function AuthGate() {
  const [user, setUser] = useState<User | null | "loading">("loading");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
    return unsubscribe;
  }, []);

  if (user === "loading") {
    return (
      <div className="auth-gate-loading">
        <i className="p-icon--spinner u-animation--spin"></i>
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  return (
    <AppShell
      onSignOut={signOutUser}
      userEmail={user.email ?? ""}
    />
  );
}
