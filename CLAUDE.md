# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server at http://localhost:3000
npm run build    # Production build
npm run lint     # eslint . — flat config in eslint.config.mjs (`next lint` was removed in Next 16)
```

There are no tests in this project.

## What this app does

RAG Snap UI is a Next.js app for inspecting and editing RAG (Retrieval-Augmented Generation) Q&A result files. Users sign in with Google (@canonical.com accounts only), load a JSON file, browse questions grouped by section, filter/search results, inline-edit answers, rate answers (1–5 stars), approve answers, attach context source URLs to unanswered questions, assign a team member and a reviewer to each section, share a live-synced session with collaborators, and export results as CSV.

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
- `approvals: Record<string, true>` — `item.id` of every human-approved answer. Present means approved; there is no `false`, and editing an answer removes its key
- `sectionAssignees: Record<string, string>` — `SectionInfo.key → TeamMember.id`. **Keyed by section, not by question** — questions are not individually assignable
- `sectionReviewers: Record<string, string>` — `SectionInfo.key → TeamMember.id`
- `teamMembers: TeamMember[]` — global team bank, loaded via `subscribeToTeamMembers` (not part of `SessionState`)
- `filters: Filters` — status/section/search state. Read through `effectiveFilters`, which drops a person filter whose option has gone rather than showing an empty list
- `override` / `viewState` — which cards are expanded and which sections are collapsed, per doc. Local view state, **not** synced (see below)
- `docId: string | null` — the open doc's saved-file id, which doubles as its RTDB session id
- `darkMode: boolean` — persisted to `localStorage`

State flows down as props; no context or state management library is used. There is no echo suppression on RTDB writes: every snapshot is applied, and `sameMap` keeps the no-op echoes from causing renders.

Card expansion and section collapse live in `lib/expansion.ts`, persisted to `localStorage` per `docId` (most-recently-touched-first, capped at 25 docs). Deliberately not synced to the session — it is one reader's view of the doc, and syncing it would let someone's collapse close a card another person was reading.

### Firebase

- **Auth** (`lib/auth.ts`, `lib/firebase.ts`): Google Sign-In restricted to `@canonical.com` accounts. Enforced in `signInWithGoogle` by checking `result.user.email`.
- **Realtime Database** (`lib/session.ts`): Session sharing. A doc's session id **is** its saved-file id, so opening the same doc always lands in the same room. `ensureSession` seeds `sessions/<docId>` in a `runTransaction` and leaves an existing node completely alone. `subscribeToSession` subscribes via `onValue`. Granular updates (`updateAnswer`, `updateRating`, `updateContextUrl`, `updateApproval`, `updateAssignee`, `updateReviewer`, etc.) write only the changed field — the assignment ones take a `SectionInfo.key`, not an `item.id`. Opening a shared link reads the `?doc=<id>` URL param on mount and fetches content from the saved-file bank, not from the room.

`encodeKey`/`decodeKey` escape everything RTDB forbids in a key (`.`, `$`, `#`, `[`, `]`, `/`), with `%` escaped first and unescaped last so the mapping stays reversible. `/` is the one that matters most: RTDB reads it as a path separator and silently nests the value instead of rejecting it, and section keys can come from producer-supplied labels like `"Security/Compliance"`.

### Team bank

`/teamMembers` is a global Firebase RTDB path (independent of any session) storing `{ [memberId]: { name: string, createdAt: number } }`. Any authenticated `@canonical.com` user can add or remove entries — it's a shared list across the whole org, not per-session.

`lib/teamBank.ts` provides:
- `subscribeToTeamMembers(onUpdate)` — subscribes via `onValue`, returns members as a `TeamMember[]` sorted by name
- `addTeamMember(name)` — pushes a new entry, returns the generated `memberId`
- `removeTeamMember(memberId)` — removes the entry from `/teamMembers`

`lib/session.ts` also exports `revertAssignmentsForMember(memberId)`, which scans all sessions under `/sessions` and clears any `sectionAssignees`/`sectionReviewers` entries pointing at the removed member, reverting those sections back to "Unassigned". This is called whenever a member is removed from the team bank.

### Key data model

An answer is considered "unanswered" if it starts with `"The provided context does not contain"` (see `lib/utils.ts:isUnanswered`).

Unanswered items: rating is disabled (shown as greyed stars). Context URL input is only shown for unanswered items, keyed off the *original* answer — an edit does not change that.

The JSON input format supports both `"results"` and `"result"` keys, and an explicit section label under either `section` or rag-cli's `source` (handled in `lib/utils.ts:parseQAFile`). Duplicate ids are de-duplicated there by appending `.1`, `.2`, … — note that this injects a `.` into those ids, which is why `chooseIdDelimiter` tests for a delimiter present in *every* id rather than for a drop in bucket count.

### Approval states

`lib/utils.ts:questionState` is the single definition of a question's state, read by the header chips, the section badges, the card hue and the status filter, so none of them can drift:

- `unanswered` — no answer text and no edit. Cannot be approved.
- `ready` — there is answer text, but nobody has signed off on it. Every answered question starts here, including one whose text arrived via an edit.
- `approved` — a human clicked Approve. The only state not derivable from the file.

Editing an answer withdraws its approval (`revokeApprovalForEdit` in `AppShell`): an approval stands for the text that was read, not for the question. "Answered" is gone as a concept — the status filter's third option is `approved`, and the export warns first when anything is still unapproved, because the CSV has no approval column and so reads as signed off.

### Sectioning

`lib/sectioning.ts:resolveSections` decides what a section is, in three tiers:

1. an explicit per-item `section` label
2. hierarchical ids — the delimiter is chosen from `. - _ : / space`, requiring the delimiter to appear in **every** id and then preferring the fewest buckets
3. TextTiling-style contiguous topic inference, for files with no section signal at all (flat ids like `1..56`)

Inference is sequential rather than clustered so it is deterministic: collaborators in one live session must derive byte-identical sections from the same file. Every section is capped at `SECTION_CAP` (10) questions, **softly** — a trailing part below 5 folds back into the one before it, so 34 becomes 10/10/14.

Resolve the map **once per file, memoised on `data`** — never over a filtered subset. Boundaries derived from a filtered list would move as the user types, visibly rearranging sections and appearing to move people's assignments. `groupBySection` and `sectionKeyOf` only ever look the map up.

Section keys are the primary key for assignment, and for inferred sections and split parts (`inferred:2`, `3~2`) they are outputs of this file. **Bump `SECTION_ALGO_VERSION` whenever a change there can re-key a section**, including any change to `SECTION_CAP`. The stamp is written into the room at seed and compared on load; a mismatch cannot be repaired, but `reportAlgoMismatch` says so out loud rather than letting the file read as though nobody was ever assigned.

### Team members & assignment

`TeamMember` (`lib/types.ts`) is `{ id, name, email, photoURL? }`, where `id` is a sanitized email under `/teamMembers`. `SessionState` includes `sectionAssignees` and `sectionReviewers` maps (`SectionInfo.key → TeamMember.id`), synced alongside `editedAnswers`/`ratings`/`contextUrls`/`approvals`.

Assignment is a property of a **section**, not a question: the section header carries one clickable box per role. The older item-keyed `assignees`/`reviewers` RTDB nodes are obsolete and deliberately neither read nor migrated — an item id and a section key can both be `"3"`, so reusing the path would resurrect a question-level assignment onto a section. Pre-existing sessions open with every section unassigned.

### Export format

CSV (not JSON). Columns: `Question, Original Answer, Edited Answer, Context URL, Rating`. Filename derives from the source JSON filename with `-export.csv` suffix.

### Component tree

```
page.tsx
└── AuthGate — Firebase auth state listener
    ├── LoginScreen — Google Sign-In button (shown when unauthenticated)
    └── AppShell (all state) — shown when authenticated
        ├── Sidebar — view switcher (inspector/database), dark mode toggle, signed-in email, sign out
        ├── Header — sticky bar with logo lockup, FileLoader, filename badge, Ready/Approved/Unanswered chips
        │   ├── FileLoader — drag-and-drop or click-to-upload, calls parseQAFile
        │   ├── ShareButton — copies the ?doc=<id> URL to the clipboard
        │   ├── ExportButton — warns if anything is unapproved, then downloads CSV (optionally removing the doc from the shared list)
        │   └── [Manage Users panel] — toggled by "Manage Users" button in the header; add/remove team bank members
        ├── [live session banner] — shown when docId is set
        ├── FilterBar — status toggle (All/Approved/Unanswered), section dropdown, search input
        ├── SectionGroup (per section)
        │   │   [section header] — label, assignee and reviewer boxes (TeamMemberSelect, keyed on SectionInfo.key),
        │   │                      Questions/Ready/Approved/Unanswered/Edited count badges, collapse toggle
        │   └── QuestionCard (per item) — box hue is the state readout: red unanswered, blue ready, green approved
        │       ├── CopyButton (inline, for original and edited answers)
        │       ├── StarRating — 1–5 stars; disabled for unanswered items
        │       ├── ContextUrlRow — URL input; only rendered for unanswered items
        │       └── [Approve button] — in the footer row, disabled for unanswered items
        └── RfpDatabaseView — mounted on first visit to the database view, then kept mounted
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

  &--positive    { background: var(--vf-color-background-positive-default);    border-color: var(--vf-color-border-positive); }
  &--negative    { background: var(--vf-color-background-negative-default);    border-color: var(--vf-color-border-negative); }
  &--caution     { background: var(--vf-color-background-caution-default);     border-color: var(--vf-color-border-caution); }
  &--information { background: var(--vf-color-background-information-default); border-color: var(--vf-color-border-information); }
}
```
Use `--positive` (green) for approved/success, `--information` (blue) for ready/in-progress, `--negative` (red) for unanswered/error, `--caution` (amber) for edited/warning. The same four tints carry the question-card hues (`.question-card--approved` / `--ready` / `--unanswered` / `--edited`), so a card and its section badges always read as the same colour.

**Hiding a collapsed panel.** Use `display: none` (`.section-cards.is-collapsed`), or `visibility: hidden` where an animation has to play out first (`.question-card__body.is-collapsed`, which delays the `visibility` flip by the length of the collapse). Never `max-height: 0` alone — the contents stay in the tab order and the accessibility tree, which is how the Approve button became reachable on a card nobody could see.

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
