"use client";

import { useState } from "react";
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
    <div className="share-button">
      <button
        onClick={handleShare}
        disabled={status === "saving"}
        className={`u-no-margin--bottom ${
          status === "success"
            ? "p-button--positive"
            : status === "error"
            ? "p-button--negative"
            : "p-button--brand"
        }`}
      >
        {status === "saving" ? (
          <>
            <i className="p-icon--spinner u-animation--spin"></i> Saving…
          </>
        ) : status === "success" ? (
          <>
            <i className="p-icon--success"></i> Link copied!
          </>
        ) : status === "error" ? (
          <>
            <i className="p-icon--error"></i> Failed
          </>
        ) : (
          <>
            <i className="p-icon--share"></i> Share session
          </>
        )}
      </button>

      {status === "success" && shareUrl && (
        <p className="share-button__status u-text--muted p-text--small u-truncate">
          {shareUrl}
        </p>
      )}
      {status === "error" && (
        <p className="share-button__status p-text--small">
          Could not save session. Check Firebase config.
        </p>
      )}
    </div>
  );
}
