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
- `assignees: Record<string, string>` — `item.id → TeamMember.id` of the assigned team member
- `reviewers: Record<string, string>` — `item.id → TeamMember.id` of the designated reviewer
- `teamMembers: TeamMember[]` — global team bank, loaded via `subscribeToTeamMembers` (not part of `SessionState`)
- `filters: Filters` — status/section/search state
- `sessionId: string | null` — Firebase RTDB session ID if sharing is active
- `darkMode: boolean` — persisted to `localStorage`

State flows down as props; no context or state management library is used. `suppressNextUpdate` ref prevents own-write echo when syncing to Firebase RTDB.

### Firebase

- **Auth** (`lib/auth.ts`, `lib/firebase.ts`): Google Sign-In restricted to `@canonical.com` accounts. Enforced in `signInWithGoogle` by checking `result.user.email`.
- **Realtime Database** (`lib/session.ts`): Session sharing. `createSession` writes full `SessionState` to `sessions/<uuid>`. `subscribeToSession` subscribes via `onValue`. Granular updates (`updateAnswer`, `updateRating`, `updateContextUrl`, `updateAssignee`, `updateReviewer`, etc.) write only the changed field. Joining a session reads the `?session=<id>` URL param on mount.

Session sharing is one-way initiator: only the file-loader can create a session (ShareButton is hidden when already in a live session). Collaborators join via shared URL and receive all updates in real time.

### Team bank

`/teamMembers` is a global Firebase RTDB path (independent of any session) storing `{ [memberId]: { name: string, createdAt: number } }`. Any authenticated `@canonical.com` user can add or remove entries — it's a shared list across the whole org, not per-session.

`lib/teamBank.ts` provides:
- `subscribeToTeamMembers(onUpdate)` — subscribes via `onValue`, returns members as a `TeamMember[]` sorted by name
- `addTeamMember(name)` — pushes a new entry, returns the generated `memberId`
- `removeTeamMember(memberId)` — removes the entry from `/teamMembers`

`lib/session.ts` also exports `revertAssignmentsForMember(memberId)`, which scans all sessions under `/sessions` and clears any `assignees`/`reviewers` entries pointing at the removed member, reverting those questions back to "Unassigned". This is called whenever a member is removed from the team bank.

### Key data model

Items have `id` strings in `"section.question"` format (e.g. `"1.2"`, `"3.10"`). Section grouping is derived by splitting on `.` and taking index 0. An answer is considered "unanswered" if it starts with `"The provided context does not contain"` (see `lib/utils.ts:isUnanswered`).

Unanswered items: rating is disabled (shown as greyed stars). Context URL input is only shown for unanswered items.

The JSON input format supports both `"results"` and `"result"` keys (handled in `lib/utils.ts:parseQAFile`).

### Team members & assignment

`TeamMember` (`lib/types.ts`) is `{ id: string, name: string }`, where `id` is the Firebase key under `/teamMembers`. `SessionState` includes `assignees` and `reviewers` maps (`item.id → TeamMember.id`), synced alongside `editedAnswers`/`ratings`/`contextUrls`.

### Export format

CSV (not JSON). Columns: `Question, Original Answer, Edited Answer, Context URL, Rating`. Filename derives from the source JSON filename with `-export.csv` suffix.

### Component tree

```
page.tsx
└── AuthGate — Firebase auth state listener
    ├── LoginScreen — Google Sign-In button (shown when unauthenticated)
    └── AppShell (all state) — shown when authenticated
        ├── Header — sticky bar with logo lockup, dark mode toggle, FileLoader, filename badge, answered/unanswered counts
        │   ├── FileLoader — drag-and-drop or click-to-upload, calls parseQAFile
        │   └── [Manage Users panel] — toggled by "Manage Users" button in the header; add/remove team bank members
        ├── [user bar] — shows signed-in email + sign out button
        ├── [live session banner] — shown when sessionId is set
        ├── FilterBar — status toggle, section dropdown, search input
        └── SectionGroup (per section)
            │   [assignee/reviewer indicator] — shows assigned name / "Reviewer: <name>" or "Unassigned" on the section header row, looked up from teamMembers via assignees/reviewers
            └── QuestionCard (per item)
                ├── CopyButton (inline, for original and edited answers)
                ├── StarRating — 1–5 stars; disabled for unanswered items
                ├── AssignmentRow — assignee and reviewer dropdowns, populated from teamMembers
                └── ContextUrlRow — URL input; only rendered for unanswered items
        └── [export footer]
            ├── ShareButton — creates Firebase session, copies URL to clipboard (hidden in live sessions)
            └── ExportButton — downloads CSV
```

### Vanilla Framework & dark mode

This project uses **Vanilla Framework v4.51.0** (migrated from Tailwind). The stylesheet entry point is `app/globals.scss`:

```scss
@use "vanilla-framework";
@include vanilla-framework.vanilla;
```

Dark mode uses Vanilla's `is-dark` class on `<html>` (toggled via `useEffect` in `AppShell.tsx`), not Tailwind's `dark:` variants. All components use Vanilla Framework utility/pattern classes plus custom classes in `globals.scss` — no CSS modules, styled-components, or Tailwind.

#### Vanilla Framework rules — read before touching CSS

**1. Verify class names before use.**
Always grep `node_modules/vanilla-framework/scss/` before using any `p-*` or `u-*` class. Do not guess — many classes look plausible but don't exist or behave differently than expected.

**2. Specificity conflicts are the #1 source of "my change does nothing" bugs.**
Vanilla's component selectors often use two classes (e.g. `.p-navigation__tagged-logo .p-navigation__logo-title`, specificity 0,2,0). A single custom class (e.g. `.app-logo-title`, specificity 0,1,0) loses regardless of source order. Fix pattern: **remove the conflicting Vanilla class from the element** so only your custom class applies, rather than trying to out-specify Vanilla.

**3. SVG sizing: always set width AND height equally.**
SVGs with a square `viewBox` use `preserveAspectRatio="xMidYMid meet"` by default. The icon content is constrained by the *smaller* dimension. Setting only `height` has no visible effect — the icon draws at the size of `width`. Always change both dimensions together.

**4. `.p-navigation` layout internals.**
- `.p-navigation` is `display: flex; flex-direction: column` (row at the navigation breakpoint), `position: relative` — it is the containing block for absolutely-positioned children.
- `.p-navigation__row` extends `%fixed-width-container` (`max-width: 80rem`, `margin: auto`) and `%vf-reset-horizontal-padding` (padding reset to 0). On screens wider than 80rem the row is centered.
- `%navigation-link` (extended by `.p-navigation__link`) sets `position: relative; overflow: hidden; width: 100%` — this will clip or missize any child you expect to flow normally. Override with `position: static; overflow: visible; width: auto` on a custom class applied to the same element.
- `.p-navigation.is-sticky` adds `position: sticky; top: 0` — sticky also establishes a containing block for absolutely-positioned descendants.

**5. Use `visibility: hidden` (not `display: none`) to hide placeholder elements.**
`visibility: hidden` keeps the element in layout so the row height/width stays stable whether or not a file is loaded. The `.header-meta__hidden` utility class does this.

#### Custom component patterns

**Square badges (`.section-header__block`)** — the canonical non-pill badge style:
```scss
.section-header__block {
  display: inline-flex; align-items: center;
  height: 1.625rem; padding: 0 0.5rem;
  border: 1px solid var(--vf-color-border-high-contrast);
  font-size: 0.875rem; white-space: nowrap;

  &--positive { background: var(--vf-color-background-positive-default); border-color: var(--vf-color-border-positive); }
  &--negative { background: var(--vf-color-background-negative-default); border-color: var(--vf-color-border-negative); }
  &--caution  { background: var(--vf-color-background-caution-default);  border-color: var(--vf-color-border-caution); }
}
```
Use `--positive` (green) for answered/success, `--negative` (red) for unanswered/error, `--caution` (amber) for edited/warning.

**Square buttons** — Vanilla buttons are rounded by default. To make them square like the "Load JSON file" button:
```scss
.file-loader__button {
  border-radius: 0;
  border-color: var(--vf-color-border-high-contrast);
}
```

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

`database.rules.json` defines RTDB access rules for `/sessions` and `/teamMembers` (both restricted to authenticated `@canonical.com` users), and `firebase.json` points the `database` deploy target at `database.rules.json`. Rule changes are not live until deployed — run `firebase deploy --only database`, which requires access to the `canonical-req-8605` Firebase project.
