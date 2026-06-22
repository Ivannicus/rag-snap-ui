"use client";

import { useState } from "react";
import { signInWithGoogle } from "@/lib/auth";

export default function LoginScreen() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Sign-in failed.";
      // Ignore user-cancelled popup
      if (!message.includes("popup-closed")) setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-strip is-shallow login-screen">
      <div className="row">
        <div className="col-6 col-start-large-4">
          <div className="p-card">
            <div className="p-card__content u-align--center">
              <h1 className="p-heading--2">RAG Snap UI</h1>
              <p className="u-text--muted">
                Sign in with your Canonical account to continue
              </p>

              {error && (
                <div className="p-notification--negative">
                  <div className="p-notification__content">
                    <p className="p-notification__message">{error}</p>
                  </div>
                </div>
              )}

              <button
                className="p-button--positive u-no-margin--bottom"
                onClick={handleSignIn}
                disabled={loading}
              >
                {loading && <i className="p-icon--spinner u-animation--spin"></i>}
                {loading ? "Signing in…" : "Sign in with Google"}
              </button>

              <p className="u-text--muted u-no-margin--bottom">
                Access restricted to @canonical.com accounts
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
