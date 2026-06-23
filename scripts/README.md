# RFP Database Import Script

Imports Q&A data from a Google Sheets CSV export into Firebase Realtime Database at `/rfpDatabase`.

## Prerequisites

- Node.js 20+
- `tsx` installed (`npx tsx` works without global install)
- `firebase-admin` installed: `npm install --save-dev firebase-admin`
- A Firebase service account JSON key with access to the `canonical-req-8605` project
- `NEXT_PUBLIC_FIREBASE_DATABASE_URL` set in `.env.local` or exported

## CSV format

The CSV must have these column headers (order doesn't matter):

```
question,answer,source,rfpDate
"What is your SLA?","99.9% uptime...","https://docs.example.com","2024-06-15"
```

## Usage

```bash
# Load env vars from .env.local
export $(grep -v '^#' .env.local | xargs)

# Run the import
npx tsx scripts/import-rfp-data.ts path/to/export.csv path/to/service-account.json
```

Or set `GOOGLE_APPLICATION_CREDENTIALS`:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json
npx tsx scripts/import-rfp-data.ts path/to/export.csv
```

## Behavior

- **Replaces** all existing data under `/rfpDatabase` on each run.
- Each record gets a Firebase push key and an `importedAt` timestamp.
- Re-run whenever the Google Sheet is updated.
