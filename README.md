# RAG Snap UI

RAG Snap UI is a Next.js application for reviewing AI-generated RFP (Request for Proposal) question-and-answer files. Canonical team members load a JSON file produced by a RAG (Retrieval-Augmented Generation) pipeline, then inspect, edit, rate, assign, and export the results — either solo or in a live, shared review session. A separate **RFP Database** view lets the team search a shared archive of previously answered RFP questions.

## Tech stack

- **[Next.js](https://nextjs.org/)** (App Router) + **React** + **TypeScript**
- **Firebase Authentication** — Google Sign-In, restricted to `@canonical.com` accounts
- **Firebase Realtime Database** — live session sharing, team member bank, saved files, and the RFP database archive
- **[Vanilla Framework](https://vanillaframework.io/)** v4.51 — Canonical's CSS framework (SCSS), used for all styling; no Tailwind or CSS modules

## Features

- **Q&A Inspector** — load a JSON results file, browse questions grouped by section, filter by status/section/assignee/reviewer, and full-text search across questions and answers.
- **Inline editing** — edit any answer in place; edited answers can always be re-edited later.
- **Star ratings** — rate answers 1–5 stars. Disabled for unanswered questions unless they've been edited.
- **Context URLs** — attach a source URL to unanswered questions to help track down supporting context.
- **Saved files, shared across the team** — uploaded files are written to Firebase so any signed-in teammate can reopen the same file from the "Load a JSON file" dropdown, without re-uploading it themselves.
- **Team bank** — a shared roster of `@canonical.com` users, auto-populated the first time each person signs in (no manual setup required).
- **Assignee & reviewer assignment** — assign a question to one team member to answer and another to review, picked from avatar dropdowns populated from the team bank.
- **Live session sharing** — generate a shareable link that syncs edits, ratings, context URLs, and assignments to collaborators in real time via Firebase Realtime Database.
- **RFP Database search** — a separate view for full-text searching a shared archive of previously answered RFP questions, imported from a Google Sheets export (see [scripts/README.md](scripts/README.md)).
- **CSV export** — export the current file's results (including edits, ratings, and context URLs) as a CSV.

## Prerequisites

- Node.js 20+
- npm
- Access to the `canonical-req-8605` Firebase project (to obtain environment variable values, and to deploy database rules)

## Setup and installation

1. **Clone the repository** and install dependencies:

   ```bash
   npm install
   ```

2. **Configure environment variables.** This app needs Firebase project credentials to run. They are intentionally **not committed** to the repository, so you'll need to get the values from a team member with access to the `canonical-req-8605` Firebase project.

   Copy the example file:

   ```bash
   cp .env.local.example .env.local
   ```

   Then fill in the following variables in `.env.local`:

   ```
   NEXT_PUBLIC_FIREBASE_API_KEY=
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
   NEXT_PUBLIC_FIREBASE_DATABASE_URL=
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
   NEXT_PUBLIC_FIREBASE_APP_ID=
   ```

   > If any of these are missing or incorrect, the app will throw a Firebase configuration error on startup.

## Running the app

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000). Sign-in requires a `@canonical.com` Google account — any other account will be rejected.

Other commands:

```bash
npm run build    # Production build
npm run start    # Run a production build
```

> The `npm run lint` script (`next lint`) is currently non-functional — `next lint` was removed in Next.js 16, and the project's ESLint config has not yet been migrated to the flat-config format ESLint 9 requires.

There are no automated tests in this project.

## Project structure

```
app/
  layout.tsx        # Root layout
  page.tsx           # Entry point — renders <AuthGate />
  globals.scss       # Vanilla Framework import + all custom styles

components/
  AuthGate.tsx           # Firebase auth state listener; shows LoginScreen or AppShell
  LoginScreen.tsx        # Google Sign-In button
  AppShell.tsx           # All app state lives here; renders the rest of the tree
  Header.tsx             # Sticky header: logo, dark mode toggle, FileLoader, view switcher, Manage Users panel
  FileLoader.tsx         # Drag-and-drop / click-to-upload JSON loader, saved-files dropdown
  FilterBar.tsx          # Status toggle, section/assignee/reviewer filter dropdown, search
  SectionGroup.tsx       # Renders one section's questions, plus assignee/reviewer indicator
  QuestionCard.tsx       # One question: edit, rate, copy, context URL
  TeamMemberSelect.tsx   # Assignee/reviewer avatar dropdown picker
  TeamMemberAvatar.tsx   # Avatar (photo or initials) for a team member
  ShareButton.tsx        # Creates a live Firebase session, copies the share URL
  ExportButton.tsx       # Downloads results as CSV
  RfpDatabaseView.tsx    # RFP Database search view (alternate to the inspector)
  RfpSearchBar.tsx       # Search + date filter for the RFP Database
  RfpResultsList.tsx     # Result list for the RFP Database
  RfpResultCard.tsx      # One RFP Database record

lib/
  firebase.ts        # Firebase app/auth/database initialization
  auth.ts             # Google Sign-In, restricted to @canonical.com
  session.ts          # Live session create/subscribe/update (Realtime Database)
  savedFiles.ts        # Team-shared saved JSON files (Realtime Database)
  teamBank.ts          # Team member roster (Realtime Database)
  rfpDatabase.ts       # RFP Database subscribe + search
  utils.ts             # JSON parsing, section grouping, unanswered-answer detection
  types.ts             # Shared TypeScript types

scripts/
  import-rfp-data.ts     # Imports a Google Sheets CSV export into /rfpDatabase
  check-rfp-size.ts      # Utility for inspecting /rfpDatabase size
```

## Firebase database structure

The Realtime Database is organized into four top-level paths, each restricted (read and write) to authenticated `@canonical.com` users (see `database.rules.json`):

| Path | Purpose |
|---|---|
| `/sessions/<sessionId>` | A shared, live-synced review session: the loaded file plus `editedAnswers`, `ratings`, `contextUrls`, `assignees`, and `reviewers` maps. |
| `/teamMembers/<memberId>` | The shared org-wide roster of `{ name, email, photoURL, createdAt }`, auto-populated on first sign-in. |
| `/savedFiles/<fileId>` | JSON result files uploaded by any teammate, so others can reopen them without re-uploading. |
| `/rfpDatabase/<recordId>` | The searchable archive of previously answered RFP questions, populated by `scripts/import-rfp-data.ts`. |

## Deploying database rules

Changes to `database.rules.json` are **not live until deployed**. Run:

```bash
firebase deploy --only database
```

This requires access to the `canonical-req-8605` Firebase project.

## Deployment

The app is deployed to **Firebase Hosting** (`firebase.json`, `.firebaserc`) as a static export (`out/`) — this is the current deployment target. A Vercel project configuration (`.vercel/`, `vercel.json`) also exists in the repo but is legacy, left over from before the project migrated to Firebase Hosting; it is not the active deployment path.
