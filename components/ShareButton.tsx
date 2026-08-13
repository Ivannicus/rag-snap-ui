"use client";

import { useState } from "react";

interface Props {
  docId: string;
}

type Status = "idle" | "success" | "error";

/**
 * Copy a link to the open doc.
 *
 * The room already exists, keyed by the doc's saved-file id, so there is no session to create and
 * nowhere to navigate. Anyone opening this URL joins the same room.
 */
export default function ShareButton({ docId }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  async function handleShare() {
    const url = new URL(window.location.href);
    url.searchParams.set("doc", docId);
    const link = url.toString();
    try {
      await navigator.clipboard.writeText(link);
      setShareUrl(link);
      setStatus("success");
      setTimeout(() => setStatus("idle"), 3000);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  }

  return (
    <div className="share-button">
      <button
        onClick={handleShare}
        className={`u-no-margin--bottom ${
          status === "success"
            ? "p-button--positive"
            : status === "error"
            ? "p-button--negative"
            : "p-button--brand"
        }`}
      >
        {status === "success" ? (
          <>
            <i className="p-icon--success"></i> Link copied!
          </>
        ) : status === "error" ? (
          <>
            <i className="p-icon--error"></i> Failed
          </>
        ) : (
          <>
            <i className="p-icon--share"></i> Copy doc link
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
          Could not copy the link. Copy it from the address bar instead.
        </p>
      )}
    </div>
  );
}
