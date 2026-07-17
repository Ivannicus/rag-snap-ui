"use client";

import type { ActiveView } from "@/components/Header";

interface Props {
  activeView: ActiveView;
  onChangeView: (view: ActiveView) => void;
  userEmail?: string;
  darkMode: boolean;
  onToggleDark: () => void;
  onSignOut?: () => void;
}

export default function Sidebar({
  activeView,
  onChangeView,
  userEmail,
  darkMode,
  onToggleDark,
  onSignOut,
}: Props) {
  return (
    <aside className="app-sidebar">
      {/* Logo */}
      <div className="app-sidebar__logo">
        <span className="app-sidebar__logo-icon">
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </span>
        <span className="app-sidebar__logo-title">RAG</span>
      </div>

      {/* Nav */}
      <nav className="app-sidebar__nav">
        <button
          onClick={() => onChangeView("inspector")}
          className={`app-sidebar__nav-item${activeView === "inspector" ? " is-active" : ""}`}
        >
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Collaborative UI
        </button>
        <button
          onClick={() => onChangeView("database")}
          className={`app-sidebar__nav-item${activeView === "database" ? " is-active" : ""}`}
        >
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 7c0-1.657 3.582-3 8-3s8 1.343 8 3M4 7v5c0 1.657 3.582 3 8 3s8-1.343 8-3V7M4 7v5M4 12v5c0 1.657 3.582 3 8 3s8-1.343 8-3v-5" />
          </svg>
          RFP Database
        </button>
      </nav>

      {/* Footer */}
      <div className="app-sidebar__footer">
        <button onClick={onToggleDark} className="app-sidebar__footer-item">
          {darkMode ? (
            <>
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
              </svg>
              Light mode
            </>
          ) : (
            <>
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
              </svg>
              Dark mode
            </>
          )}
        </button>

        {userEmail && (
          <div className="app-sidebar__user">
            <span className="app-sidebar__user-email">{userEmail}</span>
            {onSignOut && (
              <button onClick={onSignOut} className="app-sidebar__footer-item">
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign out
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
