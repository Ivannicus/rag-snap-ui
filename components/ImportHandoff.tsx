"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { signOutUser } from "@/lib/auth";
import { saveFile } from "@/lib/savedFiles";
import { parseQAFile } from "@/lib/utils";
import {
  PROTOCOL,
  PROTOCOL_VERSION,
  isAllowedSenderOrigin,
  makeReady,
  makeAck,
  makeError,
  type HandoffErrorCode,
} from "@/lib/handoff";
import type { ParsedQAFile, SessionState } from "@/lib/types";
import AppShell from "@/components/AppShell";
import LoginScreen from "@/components/LoginScreen";

type Status = "waiting" | "needs-auth" | "saving" | "loaded" | "error";

interface Sender {
  win: MessageEventSource;
  origin: string;
}

interface PendingPayload {
  data: ParsedQAFile;
  filename: string;
}

// Build a fresh SessionState for a handed-off batch — the results plus empty overlay maps, since a
// brand-new import carries no edits/ratings/assignments yet.
function toSessionState(data: ParsedQAFile, filename: string): SessionState {
  return {
    data,
    filename,
    editedAnswers: {},
    ratings: {},
    contextUrls: {},
    assignees: {},
    reviewers: {},
  };
}

export default function ImportHandoff() {
  const [user, setUser] = useState<User | null | "loading">("loading");
  const [status, setStatus] = useState<Status>("waiting");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [loadedState, setLoadedState] = useState<SessionState | null>(null);

  // The single nonce this tab was opened with; the payload must match it and it is spent on accept.
  const expectedNonce = useRef<string>("");
  const consumedNonce = useRef<Set<string>>(new Set());
  // A payload accepted before auth resolved, held until sign-in completes.
  const pending = useRef<PendingPayload | null>(null);
  // The window/origin to send ACK/ERROR back to, captured from the accepted message.
  const sender = useRef<Sender | null>(null);

  // Observe auth state (same three-state pattern as AuthGate).
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
    return unsubscribe;
  }, []);

  const reply = useCallback(
    (msg: object) => {
      const s = sender.current;
      if (!s) return;
      // event.source is a WindowProxy for an opener handoff; pin targetOrigin to the validated
      // loopback origin so the reply reaches only the intended app.
      (s.win as Window).postMessage(msg, s.origin);
    },
    []
  );

  const replyError = useCallback(
    (nonce: string, code: HandoffErrorCode, message: string) => {
      reply(makeError(nonce, code, message));
    },
    [reply]
  );

  // Persist the accepted batch to the shared savedFiles bank, then ACK + load into view.
  // Only call this once the user is authenticated.
  const persist = useCallback(
    async (data: ParsedQAFile, filename: string, nonce: string) => {
      const email = auth.currentUser?.email ?? "";
      setStatus("saving");
      try {
        await saveFile({
          filename,
          data,
          uploadedByName: auth.currentUser?.displayName ?? email ?? "Unknown",
          uploadedByEmail: email,
        });
      } catch {
        replyError(nonce, "INTERNAL", "Failed to save the handed-off results.");
        setErrorMsg("Saving the handed-off results failed. Please try again.");
        setStatus("error");
        return;
      }
      // ACK only after the write durably succeeds.
      reply(makeAck(nonce));
      setLoadedState(toSessionState(data, filename));
      setStatus("loaded");
    },
    [reply, replyError]
  );

  const onMessage = useCallback(
    (event: MessageEvent) => {
      // 1. Origin allowlist (random loopback port → match by scheme + host).
      if (!isAllowedSenderOrigin(event.origin)) return;

      const data = event.data;
      // 2. Protocol discriminator — the window receives many unrelated messages.
      if (!data || typeof data !== "object" || data.protocol !== PROTOCOL) return;

      const nonce: string = typeof data.nonce === "string" ? data.nonce : "";

      // Capture the reply target early so version/payload errors can be answered.
      if (event.source) {
        sender.current = { win: event.source, origin: event.origin };
      }

      // 3. Version check.
      if (data.version !== PROTOCOL_VERSION) {
        replyError(nonce, "UNSUPPORTED_VERSION", `Unsupported protocol version ${data.version}.`);
        return;
      }

      // 4. We only act on payloads; READY/ACK/ERROR from the sender are not ours to handle.
      if (data.type !== "HANDOFF_PAYLOAD") return;

      // 5. Nonce: must match the one this tab was opened with, and must be unspent.
      if (expectedNonce.current && nonce !== expectedNonce.current) return;
      if (consumedNonce.current.has(nonce)) return; // single-use: first payload wins, dupes dropped

      // 6. Route/validate by kind.
      const payload = data.payload;
      if (!payload || typeof payload !== "object" || payload.kind !== "answer-batch-results") {
        replyError(nonce, "BAD_PAYLOAD", "Expected an answer-batch-results payload.");
        return;
      }

      // 7. Parse the results file (tolerates result/results variance, validates shape).
      let parsed: ParsedQAFile;
      try {
        parsed = parseQAFile(payload.results_file);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not parse the results file.";
        replyError(nonce, "BAD_PAYLOAD", message);
        return;
      }

      // 8. Accept: consume the nonce now (so a stale tab can't re-trigger) and derive a filename.
      consumedNonce.current.add(nonce);
      const manifestName =
        typeof payload.manifest_name === "string" && payload.manifest_name.trim()
          ? payload.manifest_name.trim()
          : "Handoff batch";
      const filename = manifestName.toLowerCase().endsWith(".json")
        ? manifestName
        : `${manifestName}.json`;

      if (user && user !== "loading") {
        void persist(parsed, filename, nonce);
      } else {
        // Auth not ready yet — hold the payload and complete the write after sign-in.
        pending.current = { data: parsed, filename };
        setStatus("needs-auth");
      }
    },
    [persist, replyError, user]
  );

  // Install the message listener and announce readiness to the opener.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    expectedNonce.current = params.get("nonce") ?? "";

    window.addEventListener("message", onMessage);

    const announce = () => {
      // READY carries no secret, so targetOrigin "*" is acceptable per the contract.
      window.opener?.postMessage(makeReady(expectedNonce.current), "*");
    };
    announce();
    // Re-send once in case the sender's listener attached after our first READY.
    const timer = window.setTimeout(() => {
      if (consumedNonce.current.size === 0) announce();
    }, 3000);

    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    };
  }, [onMessage]);

  // Flush a payload that arrived before authentication once the user signs in.
  useEffect(() => {
    if (user && user !== "loading" && pending.current && !loadedState) {
      const { data, filename } = pending.current;
      pending.current = null;
      void persist(data, filename, expectedNonce.current);
    }
  }, [user, loadedState, persist]);

  if (status === "loaded" && loadedState) {
    return (
      <AppShell
        initialState={loadedState}
        userEmail={user && user !== "loading" ? user.email ?? "" : ""}
        onSignOut={signOutUser}
      />
    );
  }

  if (status === "needs-auth") {
    return (
      <div className="p-strip is-shallow">
        <div className="row">
          <div className="col-6 col-start-large-4 u-align--center">
            <p className="u-text--muted">
              Sign in to import the handed-off answer batch.
            </p>
          </div>
        </div>
        <LoginScreen />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="p-strip is-shallow">
        <div className="row">
          <div className="col-6 col-start-large-4">
            <div className="p-notification--negative">
              <div className="p-notification__content">
                <p className="p-notification__message">{errorMsg}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const message = status === "saving" ? "Importing…" : "Waiting for the local app…";
  return (
    <div className="p-strip is-shallow">
      <div className="row">
        <div className="col-6 col-start-large-4 u-align--center">
          <i className="p-icon--spinner u-animation--spin"></i>
          <p className="u-text--muted">{message}</p>
        </div>
      </div>
    </div>
  );
}
