## Why

The RFP team maintains ~1,000 Q&A pairs in a Google Sheet (question, answer, source columns) and needs to quickly find previously-answered questions when responding to new RFPs. Today there is no search — users must scroll or Ctrl-F the sheet. Adding a keyword search inside RAG Snap UI lets users search, filter, and reuse past answers without leaving the app, cutting response time for recurring RFP questions.

## What Changes

- **Migrate Q&A data from Google Sheets into Firebase Realtime Database** under a new `/rfpDatabase` path. Each record stores question, answer, source, and an RFP date field. A one-time import script converts the sheet export (CSV/JSON) into RTDB records.
- **Add a new "RFP Database" page/view** accessible from the header, separate from the existing file-inspection workflow. This is a read-only search interface over the centralised Q&A database.
- **Implement client-side lexical keyword search** over the in-memory dataset. At ~1,000 rows the full dataset fits comfortably in the browser; no server-side search index is needed. Search matches against question and answer text.
- **Add a date filter** so users can narrow results by the RFP date (the new 4th column).
- **Restrict access** to authenticated `@canonical.com` users, consistent with existing Firebase RTDB rules.

## Capabilities

### New Capabilities
- `rfp-database`: Central Firebase RTDB storage for the Q&A knowledge base, including data model, import tooling, and access rules.
- `rfp-search`: Client-side keyword search UI with results display, date filtering, and integration into the app shell.

### Modified Capabilities
_None — this feature is additive and does not change existing file-inspection or session-sharing behaviour._

## Impact

- **Firebase RTDB**: New `/rfpDatabase` path added; `database.rules.json` updated with read/write rules for authenticated `@canonical.com` users.
- **Navigation**: Header gains a route or toggle to switch between the existing file-inspection view and the new RFP Database search view.
- **Dependencies**: No new npm packages required — Firebase SDK and existing stack are sufficient for client-side search.
- **Data pipeline**: One-time import script needed to seed RTDB from the current Google Sheet export. Future sheet updates will require re-import (manual or scripted).
