"use client";

import React, { useState } from "react";
import { createSession } from "@/lib/session";
import type { SessionState } from "@/lib/types";

interface Props {
  sessionState: SessionState;
}

type Status = "idle" | "saving" | "success" | "error";

export default function ShareButton({ sessionState }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  async function handleShare() {
    setStatus("saving");
    setShareUrl(null);
    try {
      const sessionId = await createSession(sessionState);
      const url = `${window.location.origin}?session=${sessionId}`;
      await navigator.clipboard.writeText(url);
      setShareUrl(url);
      setStatus("success");
      setTimeout(() => setStatus("idle"), 6000);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleShare}
        disabled={status === "saving"}
        className={`
          inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm
          transition-all shadow-sm disabled:opacity-60
          ${status === "success"
            ? "bg-green-500 text-white"
            : status === "error"
            ? "bg-red-500 text-white"
            : "bg-gray-700 hover:bg-gray-800 active:scale-95 text-white dark:bg-gray-600 dark:hover:bg-gray-500"
          }
        `}
      >
        {status === "saving" ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Saving…
          </>
        ) : status === "success" ? (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Link copied!
          </>
        ) : status === "error" ? (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Failed
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            Share session
          </>
        )}
      </button>

      {status === "success" && shareUrl && (
        <p className="text-xs text-green-600 dark:text-green-400 max-w-xs truncate text-right">
          {shareUrl}
        </p>
      )}
      {status === "error" && (
        <p className="text-xs text-red-500 dark:text-red-400 text-right">
          Could not save session. Check Firebase config.
        </p>
      )}
    </div>
  );
}
