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
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <svg className="w-6 h-6 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
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
