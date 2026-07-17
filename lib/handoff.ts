// Cross-app postMessage handoff — receiver-side protocol constants and pure helpers.
//
// The sender is the local UI (ragd) on a random loopback port; it opens this app and pushes an
// answer-batch results file over window.postMessage. See the handoff contract for the full flow.
// This module holds the security-critical origin check plus the message envelope factories, kept
// free of React/Firebase so the validation logic is easy to reason about in isolation.

export const PROTOCOL = 'rag-answer-batch-handoff';
export const PROTOCOL_VERSION = 1;

export type HandoffErrorCode =
  | 'UNSUPPORTED_VERSION'
  | 'BAD_PAYLOAD'
  | 'NONCE_CONSUMED'
  | 'INTERNAL';

/**
 * The sender's origin is a random loopback port, so we match by scheme + host rather than an exact
 * string. Accept only http:// on 127.0.0.1, localhost, or ::1 (any port). A malformed origin
 * (e.g. the "null" origin) fails the URL parse and is rejected.
 */
export function isAllowedSenderOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:') return false;
    const host = url.hostname;
    return (
      host === '127.0.0.1' ||
      host === 'localhost' ||
      host === '[::1]' ||
      host === '::1'
    );
  } catch {
    return false;
  }
}

export function makeReady(nonce: string) {
  return {
    protocol: PROTOCOL,
    version: PROTOCOL_VERSION,
    type: 'HANDOFF_READY' as const,
    nonce,
  };
}

export function makeAck(nonce: string) {
  return {
    protocol: PROTOCOL,
    version: PROTOCOL_VERSION,
    type: 'HANDOFF_ACK' as const,
    nonce,
  };
}

export function makeError(nonce: string, code: HandoffErrorCode, message: string) {
  return {
    protocol: PROTOCOL,
    version: PROTOCOL_VERSION,
    type: 'HANDOFF_ERROR' as const,
    nonce,
    error: { code, message },
  };
}
