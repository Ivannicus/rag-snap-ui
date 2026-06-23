# RFP Database — Usage Guide

## Overview

The RFP Database is a searchable knowledge base of previously answered RFP questions, accessible from within RAG Snap UI. It allows the team to quickly find and reuse past answers when responding to new RFPs.

## Accessing the RFP Database

1. Sign in at https://canonical-req-8605.web.app with your `@canonical.com` Google account
2. In the header, click the **RFP Database** toggle button to switch from the File Inspector view
3. Click **File Inspector** to switch back at any time — your file inspection state is preserved

## Searching

### Keyword search

Type any keyword in the search box. The search is:
- **Case-insensitive** — "kubernetes" matches "Kubernetes", "KUBERNETES", etc.
- **Substring matching** — "kube" matches "Kubernetes"
- **Searches both fields** — matches against question text and answer text

Results appear instantly since the full dataset is loaded in-memory.

### Date filter

Use the date dropdown to narrow results to a specific RFP date. The dropdown is populated from the dates present in the imported data.

The date filter combines with keyword search — when both are active, results must match **both** the keyword and the selected date.

### No-query state

When no search term or date filter is active, the view shows a prompt with the total record count (e.g., "1012 records available") instead of rendering all records at once.

## Data freshness

The "Last imported" timestamp in the header shows when the data was last pushed to Firebase. If the data looks stale, ask someone with Firebase project access to re-run the import.

## Importing / updating data

The RFP Database is populated from a Google Sheets CSV export via a command-line script. This is an admin task — it requires Firebase project access.

### Prerequisites

- Node.js 20+
- `firebase-admin` and `tsx` installed (`npm install --save-dev firebase-admin tsx`)
- A Firebase service account JSON key for the `canonical-req-8605` project
  - Get it from: Firebase Console > Project Settings > Service Accounts > Generate new private key
  - Save as `service-account.json` in the project root (gitignored)

### CSV format

Export your Google Sheet as CSV. The script expects these column headers (case-insensitive):

| Column | Maps to | Required |
|--------|---------|----------|
| Question | `question` | Yes |
| Answer | `answer` | Yes |
| Source | `source` | Yes |
| Date | `rfpDate` | Yes |

Multi-line answers (newlines inside quoted fields) are handled correctly.

### Running the import

```bash
# Load environment variables
export $(grep -v '^#' .env.local | xargs)

# Run the import
npx tsx scripts/import-rfp-data.ts <path-to-csv> ./service-account.json
```

Example:
```bash
npx tsx scripts/import-rfp-data.ts master-rfp.csv ./service-account.json
```

### What the import does

- **Replaces** all existing data under `/rfpDatabase` in Firebase RTDB
- Each record gets a unique Firebase push key and an `importedAt` timestamp
- Re-run whenever the Google Sheet is updated with new Q&A pairs

### Deploying rule changes

If the database rules have been modified (e.g., after a fresh clone), deploy them:

```bash
firebase deploy --only database
```

## Architecture notes

- **Data store**: Firebase Realtime Database at `/rfpDatabase/{recordId}`
- **Access control**: Read/write restricted to authenticated `@canonical.com` users via RTDB security rules
- **Search**: Client-side in-memory filtering — the full dataset (~1 MB for ~1,000 records) is loaded once on view activation
- **No live sync**: The data is read-only from the UI. Updates require re-running the import script

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Database is empty" | Data hasn't been imported yet | Run the import script |
| "Failed to load database: permission_denied" | Database rules not deployed, or not signed in | Run `firebase deploy --only database` and verify you're signed in with `@canonical.com` |
| Search feels slow | Dataset has grown very large (>5,000 records) | This is expected at scale — consider adding pagination in a future update |
| Stale data | Google Sheet was updated but import wasn't re-run | Re-run the import script with the latest CSV export |
| Import says "Missing required columns" | CSV headers don't match expected names | Ensure headers are `Question`, `Answer`, `Source`, `Date` (case-insensitive) |
