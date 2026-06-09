# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server at http://localhost:3000
npm run build    # Production build
npm run lint     # ESLint via next lint
```

There are no tests in this project.

## What this app does

RAG Snap UI is a Next.js app for inspecting and editing RAG (Retrieval-Augmented Generation) Q&A result files. Users sign in with Google (@canonical.com accounts only), load a JSON file, browse questions grouped by section, filter/search results, inline-edit answers, rate answers (1–5 stars), attach context source URLs to unanswered questions, share a live-synced session with collaborators, and export results as CSV.

## Architecture

### Entry point

`app/page.tsx` is minimal — it renders `<AuthGate />`, which handles Firebase auth state and either shows `<LoginScreen />` or `<AppShell />`.

### State

All app state lives in `components/AppShell.tsx`:
- `data: ParsedQAFile | null` — loaded file items
- `filename: string | null` — original filename
- `editedAnswers: Record<string, string>` — `item.id → edited text`
- `ratings: Record<string, number>` — `item.id → 1–5 star rating`
- `contextUrls: Record<string, string>` — `item.id → URL string` (only on unanswered items)
- `filters: Filters` — status/section/search state
- `sessionId: string | null` — Firebase RTDB session ID if sharing is active
- `darkMode: boolean` — persisted to `localStorage`

State flows down as props; no context or state management library is used. `suppressNextUpdate` ref prevents own-write echo when syncing to Firebase RTDB.

### Firebase

- **Auth** (`lib/auth.ts`, `lib/firebase.ts`): Google Sign-In restricted to `@canonical.com` accounts. Enforced in `signInWithGoogle` by checking `result.user.email`.
- **Realtime Database** (`lib/session.ts`): Session sharing. `createSession` writes full `SessionState` to `sessions/<uuid>`. `subscribeToSession` subscribes via `onValue`. Granular updates (`updateAnswer`, `updateRating`, `updateContextUrl`, etc.) write only the changed field. Joining a session reads the `?session=<id>` URL param on mount.

Session sharing is one-way initiator: only the file-loader can create a session (ShareButton is hidden when already in a live session). Collaborators join via shared URL and receive all updates in real time.

### Key data model

Items have `id` strings in `"section.question"` format (e.g. `"1.2"`, `"3.10"`). Section grouping is derived by splitting on `.` and taking index 0. An answer is considered "unanswered" if it starts with `"The provided context does not contain"` (see `lib/utils.ts:isUnanswered`).

Unanswered items: rating is disabled (shown as greyed stars). Context URL input is only shown for unanswered items.

The JSON input format supports both `"results"` and `"result"` keys (handled in `lib/utils.ts:parseQAFile`).

### Export format

CSV (not JSON). Columns: `Question, Original Answer, Edited Answer, Context URL, Rating`. Filename derives from the source JSON filename with `-export.csv` suffix.

### Component tree

```
page.tsx
└── AuthGate — Firebase auth state listener
    ├── LoginScreen — Google Sign-In button (shown when unauthenticated)
    └── AppShell (all state) — shown when authenticated
        ├── Header — sticky bar with FileLoader, file metadata, answered/unanswered counts, dark mode toggle
        │   └── FileLoader — drag-and-drop or click-to-upload, calls parseQAFile
        ├── [user bar] — shows signed-in email + sign out button
        ├── [live session banner] — shown when sessionId is set
        ├── FilterBar — status toggle, section dropdown, search input
        └── SectionGroup (per section)
            └── QuestionCard (per item)
                ├── CopyButton (inline, for original and edited answers)
                ├── StarRating — 1–5 stars; disabled for unanswered items
                └── ContextUrlRow — URL input; only rendered for unanswered items
        └── [export footer]
            ├── ShareButton — creates Firebase session, copies URL to clipboard (hidden in live sessions)
            └── ExportButton — downloads CSV
```

### Tailwind & dark mode

Dark mode is class-based (`dark:` variants). The `"dark"` class is toggled on `<html>` via `useEffect` in `AppShell.tsx`. All components use Tailwind only — no CSS modules or styled-components.

## Environment variables

Required `NEXT_PUBLIC_FIREBASE_*` vars (see `.env.local.example`):
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_DATABASE_URL`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

## Deployment

Deployed to Firebase Hosting (`firebase.json`, `.firebaserc`). Also has a Vercel project config (`.vercel/`).
