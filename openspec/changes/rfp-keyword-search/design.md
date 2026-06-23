## Context

RAG Snap UI is a Next.js app deployed on Firebase Hosting. It currently works as a file-inspection tool: users load a JSON file, browse Q&A items, and collaborate via Firebase RTDB sessions. There is no persistent Q&A knowledge base — each session starts from a fresh file upload.

The RFP team maintains ~1,000 Q&A pairs in a Google Sheet (question, answer, source columns). They want to search this corpus from within the app to reuse answers when responding to new RFPs. A 4th column (RFP date) will be added for filtering.

Existing infrastructure: Firebase Auth (Google, `@canonical.com` only), Firebase RTDB for sessions and team members, Vanilla Framework for UI.

## Goals / Non-Goals

**Goals:**
- Store the Q&A knowledge base in Firebase RTDB so it's accessible to all authenticated users
- Provide fast, in-browser keyword search across questions and answers
- Allow filtering results by RFP date
- Provide a one-time import path from Google Sheet export to RTDB
- Keep the feature additive — existing file-inspection workflow is unchanged

**Non-Goals:**
- Full-text search engine (Elasticsearch, Algolia, etc.) — overkill for 1K rows
- Live Google Sheets sync or API integration — manual import is sufficient
- Semantic/vector search — lexical keyword matching covers the use case
- CRUD editing of the Q&A database from the UI — it's a read-only search interface
- Pagination or server-side search — the full dataset loads client-side

## Decisions

### 1. Data store: Firebase RTDB (not Firestore, not keep-in-Sheets)

**Choice:** Store Q&A records under `/rfpDatabase` in the existing Firebase RTDB instance.

**Alternatives considered:**
- **Keep Google Sheets as source, query via Sheets API**: Adds API key management, latency, and rate-limit concerns. Requires a backend or Cloud Function as proxy since the Sheets API isn't designed for end-user search.
- **Migrate to Firestore**: Better querying, but the rest of the app uses RTDB. Adding a second database engine increases complexity for no benefit at 1K rows.
- **SQLite / Vercel Postgres**: The app is Firebase-native. Adding a second data backend doesn't justify itself.

**Rationale:** RTDB is already in the stack, the dataset fits in a single read (~1K records ≈ 1-2 MB), and access rules follow the existing `@canonical.com` pattern. The team can re-import by overwriting `/rfpDatabase`.

### 2. Search approach: client-side in-memory filter

**Choice:** Load the full `/rfpDatabase` into memory on mount, then filter with `String.includes()` (case-insensitive) on question + answer fields.

**Alternatives considered:**
- **Firebase RTDB queries** (`orderByChild` + `startAt`): Only supports prefix matching on a single field — not useful for keyword search across two fields.
- **Cloud Function search endpoint**: Adds latency, cold-start, and a new deploy surface. Not needed at this scale.
- **Fuse.js or Lunr.js**: Fuzzy/ranked search libraries. Could be added later, but simple `includes()` matching is sufficient for exact keyword lookup and avoids a new dependency.

**Rationale:** 1K records is trivially small for in-memory filtering. The approach requires zero new dependencies and keeps search instant (<10ms).

### 3. Data model

```
/rfpDatabase/{recordId}
  question: string
  answer: string
  source: string
  rfpDate: string        // ISO 8601 date, e.g. "2024-06-15"
  importedAt: number     // Date.now() at import time
```

`recordId` is a Firebase push key generated during import. The `rfpDate` field enables the date filter. `importedAt` tracks when the record was added (useful if re-imports are partial).

### 4. Import mechanism: CLI script (not UI uploader)

**Choice:** A Node.js script in `scripts/import-rfp-data.ts` that reads a CSV or JSON export from Google Sheets and writes to `/rfpDatabase`.

**Rationale:** Import is infrequent (when the sheet is updated) and admin-only. A script is simpler than building an upload UI, and it can be re-run to overwrite with fresh data. The script requires Firebase Admin SDK credentials (service account), which are already available to the team for `firebase deploy`.

### 5. UI placement: view toggle in the header

**Choice:** Add a toggle/tab in the header to switch between "File Inspector" (current view) and "RFP Database" (new search view). Both views share `AppShell` as the parent but render different content areas.

**Alternatives considered:**
- **Separate route (`/search`)**: Next.js routing would work, but the app is currently single-page with all state in `AppShell`. Adding routing is a larger refactor.
- **Modal/drawer overlay**: Awkward for a full search results list.

**Rationale:** A view toggle keeps the single-page architecture intact and is the smallest change. The toggle state can be a simple `activeView: "inspector" | "database"` in `AppShell`.

## Risks / Trade-offs

- **Dataset size growth** → If the Q&A corpus grows beyond ~10K records, client-side loading may feel slow on poor connections (~10 MB). Mitigation: monitor size; if it grows, paginate the RTDB read or move to Firestore with server queries.
- **Stale data** → The RTDB copy can drift from the Google Sheet if someone forgets to re-import. Mitigation: show `importedAt` timestamp in the UI so users know how fresh the data is. Document the import process.
- **Import requires admin credentials** → The import script needs a service account key. Mitigation: document setup; restrict the script to team members who already have Firebase project access.
- **No ranking** → Simple `includes()` returns unordered matches. Mitigation: sort results by relevance (match in question ranks higher than match only in answer) or by date. Can add Fuse.js later if needed.
