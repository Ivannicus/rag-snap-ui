# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server at http://localhost:3000
npm run build    # Production build (also runs the TypeScript check)
npx tsc --noEmit # Type check on its own
npm run lint     # eslint . — flat config in eslint.config.mjs (`next lint` was removed in Next 16)
```

All three are gates. `npm run lint` in particular: it enforces `react-hooks/set-state-in-effect`, which
this codebase breaks easily — the dashboard and the question card both grew several violations while the
lint script was broken and nobody could see them. Where an effect genuinely has to set state (a
`localStorage` read that must not run during a prerender, say) the convention is an
`// eslint-disable-next-line react-hooks/set-state-in-effect -- <reason>` rather than a silent exception.

There are no tests in this project. Verify by hand with `npm run dev`.

## What this app does

RAG Snap UI is a Next.js app for managing and reviewing RAG (Retrieval-Augmented Generation) Q&A
result files, which the app calls **projects**. Users sign in with Google (@canonical.com accounts
only). A lead uses the **Overview** dashboard to see every project in flight, assign owners, set due
dates and watch live progress; reviewers open a project in the **Collaborative UI** to browse questions
by section, filter/search, inline-edit answers, rate them, approve them, and export the results as CSV.
All work syncs live between everyone with the project open.

## Architecture

### Entry point

`app/page.tsx` renders `<AuthGate />`, which handles Firebase auth state and shows either
`<LoginScreen />` or `<AppShell />`. `app/import/page.tsx` renders `<ImportHandoff />`, a postMessage
receiver for batches handed off from a local tool (the snap). It bypasses `AuthGate` and observes auth
itself.

**The handoff saves, ACKs, then configures, in that order, and the order is the contract.** The batch is
written with `saveFile` on accept and `HANDOFF_ACK` goes back as soon as that write lands, so the sender
is never left waiting on a human. Only then does the shell open the shared `NewProjectModal` over it —
through `initialProjectSetup`, which stages a project whose record *already exists*, so submitting
configures it (`setDueDate` + a seeded room) instead of creating it again. Backing out is a **discard**
on this path: the record is already in the bank, so cancelling removes it.

Two things in that seam are load-bearing:

- **Read `saveFile`'s result.** It does not throw for the outcomes that write nothing — it *returns*
  them. Discarding it is what let a `duplicate` or a `filenameConflict` be ACKed as a durable save.
  `filenameConflict` now answers `HANDOFF_ERROR` and stores nothing; `duplicate` is ACKed (that content
  *is* in the bank) and offers the project it turned out to be, via the app's own `?doc=` entry.
- **The handoff tab gets a real `docId`**, from the submit that seeds its room. It did not before, so
  `ensureSession` never ran and `writeToSession` short-circuited: every rating, edit and approval made in
  a handed-off tab was dropped in silence and lost on reload.

### Views

`AppShell` switches between three views with `activeView: ActiveView` (`"overview" | "inspector" |
"database"`, the type declared in `components/Header.tsx`). The sidebar sets it.

**"overview" is the landing view.** Each view is mounted on first visit and then kept mounted, hidden
with `u-hide` rather than unmounted, so its subscriptions and scroll position survive a switch — see
`hasVisitedOverview` / `hasVisitedDatabase`. Per-view scroll offsets live in the `scrollPositions` ref.

`Header` renders *outside* that toggle and is gated on `activeView !== "overview"`: it is the open
document's toolbar (file loader, filename, Share, Export, counts) and has nothing to say on the
dashboard.

### State

Document state lives in `components/AppShell.tsx` and flows down as props — no context, no state
library:

- `data: ParsedQAFile | null`, `filename: string | null`
- `editedAnswers: Record<string, string>` — `item.id → edited text`
- `ratings: Record<string, number>` — `item.id → 1–5 stars`
- `contextUrls: Record<string, string>` — `item.id → URL`; **read-only, no writer** (see below)
- `itemStatus: Record<string, ItemStatus>` — `item.id → "approved"`
- `sectionAssignees` / `sectionReviewers: Record<string, string>` — section key → `TeamMember.id`
- `projectAssignees: Record<string, true>` — the open project's owners. Read **and written** here: the
  inspector needs it because owners gate who a section may name, and the header's **Manage Team
  Members** panel edits that roster (`handleChangeProjectOwners`, through `writeToSession`). The
  dashboard's owner pickers write the same node. Two writers is safe because `setProjectAssignees` is a
  per-key merge patch — each id written as `true` or an explicit `null` — so two views changing
  different owners at once say nothing about each other's keys. **Do not patch local state on that
  write**: owners are a subscribed map, so the echo updates the screen (see `writeToSession`)
- `teamMembers: TeamMember[]` — the global team bank (not part of `SessionState`)
- `filters: Filters` — read through `effectiveFilters`, which drops a person filter whose option has
  gone rather than showing an empty list. `OverviewView` does the same with `effectiveOwnerFilter`
- `override` / `viewState` — which cards are expanded and which sections are collapsed, per doc
- `darkMode: boolean` (persisted to `localStorage`)
- `docId: string | null` — the open project; **also its session id** (see below)

There is no echo suppression on remote snapshots. Every snapshot is applied, including the echo of the
app's own write: RTDB reflects local writes locally before the server confirms them, so an echo can
never carry a stale value, and writes are per field so an echo for one item cannot clobber another.
`sameMap` keeps the no-op echoes from causing renders.

Card expansion and section collapse live in `lib/expansion.ts`, persisted to `localStorage` per `docId`
(most-recently-touched first, capped at 25 docs). Deliberately **not** synced to the session — it is one
reader's view of the doc, and syncing it would let someone's collapse close a card another person was
reading. `override` holds the doc it belongs to alongside its state, so a stale entry cannot be applied
to the wrong doc across a switch.

The dashboard holds its own state in `components/OverviewView.tsx` rather than in `AppShell`.

### Firebase

- **Auth** (`lib/auth.ts`, `lib/firebase.ts`): Google Sign-In restricted to `@canonical.com`, enforced
  in `signInWithGoogle`.
- **RTDB**: five top-level nodes — `/savedFiles`, `/savedFileData`, `/sessions`, `/teamMembers`,
  `/archivedProjects` (plus `/rfpDatabase` for the unrelated RFP search view).

**A project's session id is its saved-file id.** `sessions/<id>` and `savedFiles/<id>` share a key, so
opening the same project always joins the same room instead of minting a new one. `ensureSession` seeds
the room via `runTransaction` (idempotent, and safe when two people open a project at once);
`subscribeToSession` listens with `onValue`; the granular writers (`updateAnswer`, `updateItemStatus`,
`setProjectAssignees`, …) each write one field.

Sharing is a URL: `?doc=<id>`. `AppShell` reads it on mount and fetches the document from
`savedFiles/<id>` rather than waiting on a room snapshot, so a link works even for a project whose room
was never seeded.

**`handleLoad` clears the overlays only when the doc id actually changes** (`docIdRef.current !==
loadedDocId`), and that guard is load-bearing. `setDocId` bails out on an unchanged value, so the
subscription effect does not re-run, and `onValue` has already delivered its initial snapshot and has no
*change* to re-send — nothing would refill what was cleared. Re-opening the doc already on screen (what
clicking it on the dashboard does) therefore used to blank owners, approvals and section assignees until
somebody else happened to write something. The overlays on screen already belong to that doc, so a
re-open has nothing to clear.

RTDB forbids `.`, `$`, `#`, `[`, `]` and `/` in keys, so item ids like `"1.1"` are stored encoded.
**`encodeKey`/`decodeKey` are exported from `lib/session.ts` — use them. Do not hand-roll a second
codec.** `%` is escaped first and unescaped last, so the mapping stays reversible for a key that already
contains a percent sequence. `/` is the one that matters most: RTDB reads it as a path separator and
silently *nests* the value instead of rejecting it, and section keys can come from producer-supplied
labels like `"Security/Compliance"`. `projectAssignees` is the exception: it is keyed by `TeamMember.id`,
a sanitized email, which needs no encoding.

### Projects: `/savedFiles` + `/savedFileData`

`savedFiles/<pushId>` holds `filename`, uploader details, `contentHash`, plus dashboard metadata:
`itemCount`, `aiUnansweredIds`, `dueDate`, `exportedAt`/`exportedBy`/`exportedByEmail`.

**The document itself lives at `savedFileData/<pushId>`, keyed the same.** RTDB returns the whole
subtree under any path you read, so a document stored *on* the record made every list of the bank
transfer every document in it — `subscribeToSavedFiles` did that live, again on each upload, removal,
due-date edit and export stamp. Nesting it deeper would not have helped; only reading a different path
does. Both are written and removed in single multi-path `update`s at the root, so a record cannot exist
without its document or outlive it.

Records written before the split still carry an inline `data` child. `getSavedFile` falls back to it,
and `listProjectMetas` migrates each one as it meets it (`migrateInlineData`), so the expensive shape
drains away rather than needing a script. **Read a document only through `getSavedFile`** — never
`savedFiles/<id>/data` directly, or you will miss the migrated ones.

`saveFile` refuses duplicates two ways, and the difference matters: a matching `contentHash` means the
bank already holds this document (open `existingId`), whereas a matching *filename* with different
content means a different document owns that name (nothing safe to open — surface the clash).

**A project's name is the record's `filename`, and it is editable.** `NewProjectModal` seeds a Project
name field from the incoming file's name; the picked-file path simply mints the record with whatever
came back, and the snap-handoff path — whose record already exists — goes through `renameSavedFile`.
That function repeats `saveFile`'s filename-uniqueness check (excluding itself) before writing, because
renaming is otherwise the way around it, and it writes through `updateExistingDoc` so a record someone
removed meanwhile is not resurrected as a ghost holding nothing but a name. The rename is **awaited**
before the project opens, unlike the due date beside it: it can be refused, and reporting a clash after
the project is already on screen would leave it showing a name it was not saved under. There is no
rename control anywhere else — the name is chosen once, at setup.

`itemCount` and `aiUnansweredIds` are **denormalized on purpose**, so the dashboard can size its status
bands without loading any document. Records predating them are backfilled once by `listProjectMetas`.

**Never `update()` a `savedFiles/<id>` record to edit it.** RTDB creates the node when it is absent, so
editing a project someone else removed writes a partial ghost with no `filename` and no `uploadedAt`.
Go through `updateExistingDoc`, which aborts in a `runTransaction` when the record is gone; the read
paths also skip records too partial to draw.

### The Overview dashboard and its bandwidth rule

**Never read `data` to render the dashboard.** With thirty projects on screen that would transfer the
whole corpus twice over. The split:

- `listProjectMetas()` (`lib/savedFiles.ts`) — **one-shot** metadata read, cheap now that documents live
  under `/savedFileData`. Still one-shot rather than watched: the project list changes only through
  actions the app itself takes, so `AppShell` bumps `overviewRefreshKey` on each entry to the tab (and
  after an export) to re-read it instead of holding a listener open.
- `subscribeToProjectOverlays()` (`lib/projects.ts`) — **live**, five small child-path listeners per
  project: `itemStatus`, `editedAnswers`, `ratings`, `sectionAssignees`, `projectAssignees`. Never
  `data`. `editedAnswers` is the one heavy member and is needed anyway — see the status model below.
  **It calls back once as soon as all five listeners have delivered a first snapshot, whether or not
  anything differed from empty.** That single exception to the change filter is what lets a caller tell
  "no assignments" from "not loaded yet": a room with no `sectionAssignees` and no `projectAssignees`
  reports `{}` for every key, `sameMap` finds no change, and without it `onUpdate` would never fire at
  all — so an id's presence in `overlaysById` is a meaningful "settled" test. The settle is reported
  after the *last* key arrives, so it is one extra call per project on mount, not five. `settled` is a
  Set of keys rather than a countdown, because a key firing twice before another fires once must not
  count twice.
- `sameOverlays` / `sameMap` guard re-renders. **Nothing in this tree is memoized**, so an unguarded
  snapshot re-renders the whole grid.

### Cards and list are two renderers over one pipeline

**Both of the dashboard's switches are `ModeToggle`** — `tab: "projects" | "mine"` in the header and
`viewMode: "cards" | "list"` in the controls row. The tab pair used to be filled
`p-button--brand`/`--base` buttons, which put them in the same visual register as the two *actions*
beside them (New project, Manage Users) and left the header reading as four buttons rather than one
switch and two actions. One component means one `aria-pressed` pair and one bar treatment, so the two
switches cannot drift. Both set `--underline-tabs-bar` to brand orange; the tab toggle skips
`.overview__view-toggle`'s grid equalisation, because it sits in a free-flowing header row rather than in
a control column whose width its halves have to share.

`viewMode: "cards" | "list"` in `OverviewView` picks between `ProjectCard` in a grid and
`ProjectListRow` in a list. Everything upstream is shared — the same `visibleProjects`, the same
`ProjectStats`, the same selection and the same write handlers — so the toggle costs no extra reads and
cannot show different numbers in the two views. Persisted to `localStorage` under `overviewViewMode`,
read in an effect rather than in the initial state because `output: 'export'` prerenders this component
and a stored initial value would not match the prerendered HTML (`AppShell` loads dark mode the same
way).

The list is **not a slimmed-down card**. It carries name, an approved bar, the three status counts and
owners, and deliberately drops the wheel, due date, uploader, export stamp and the Open button — the
filename is the open target. A row that carried everything would be a card again, only narrower. So
`ProjectListRow` takes no `onChangeDueDate`; due dates are edited in the card view.

Its grid template lives on **`.project-list__row`, not on the container**, because each row needs its
own border and selected/overdue state and `display: contents` would discard both. Repeating the template
is what aligns the columns down the page, and it is why **no track is `auto`** — `auto` sizes itself per
row and staggers the values. The widths are custom properties on `.project-list` — `--list-col-select`,
`--list-col-name`, `--list-col-bar`, `--list-col-approved`, `--list-col-ready`, `--list-col-unanswered`,
`--list-col-team` — so the header row, the project rows and the narrow-screen flex bases all read them
from one place.

**The name is the only elastic track** (`minmax(18rem, 1fr)`); every other one is fixed. That is what
puts the whole right-hand group — bar, three bands, team — flush against the row's right edge instead of
leaving dead space there, and the name is the right track to absorb it because its content ellipses
anyway. Alignment down the page survives precisely because nothing else is elastic: **a second `1fr`
would break it.**

Note what that does and does not mean: the *group* of columns is anchored to the row's right edge, while
the content of every column — heading and cell alike — reads from that column's own left edge. Both
requested, and they are not in tension.

Two more consequences worth not undoing:

- **Each status band owns a track**, and `ProjectListRow` renders a `.project-list__badge` wrapper for
  every band whether or not its count is nonzero. A band at zero drops its badge and leaves the cell
  empty; dropping the wrapper instead would let the bands after it slide left out from under their
  headings. The three tracks are in `STATUS_BANDS` order, and the header row maps the same array — so
  reordering the array means reordering the three tracks in the SCSS with it.
- **The count inside a badge is padded to three digits** (`.project-list__badge-count`: `min-width: 3ch`,
  right-aligned, tabular figures), so every badge in a band draws at one width and the labels stop
  staggering down the column — `1 Ready` is exactly as wide as `129 Ready`. `min-width`, not `width`, so a
  fourth digit widens the tile instead of colliding with the label. The gap to the label is a **margin on
  the count, not a space in the markup**: `.section-header__block` is an inline flex container, where a
  whitespace-only run between two flex items is not rendered at all. In the list the badge also takes
  `padding-right: 1.5rem` — scoped to `.project-list__badge`, since the section headers want the tighter
  symmetric padding — so there is trailing room after the label to match the pad before the digits. The
  three `--list-col-*` widths are sized for that padded badge, **so they move together with it**: widen the
  padding without widening the tracks and the difference comes out of the label.
- **Nothing in the badge cell shrinks** (`.project-list__badge > * { flex: none }`). The cell is a flex
  container, so by default a track a shade too narrow does not overflow visibly — it compresses the badge
  and `white-space: nowrap` cuts the label off inside its own border, which reads as a broken style rather
  than a width needing a quarter-rem more. It hid a too-narrow Approved column once already.
- **The filename truncates on a child, `.project-list__filename-text`**, not on the button. The button is
  a flex container (it also holds the opening spinner) and `text-overflow` applies to block containers
  only, so on the button itself it would clip with no ellipsis. The button carries `min-width: 0` because
  a grid item's automatic minimum size is its content, which would otherwise push past the track.

Below `60rem` the row stops being a grid and becomes a wrapping flex row. Aligned columns are the first
thing to go — the header is hidden there, so there is nothing to align under, and an empty badge slot
would spend width the row no longer has. `.project-list__badge:empty { display: none }` collapses them.

Every `onValue` subscription in this codebase returns **`onValue`'s own unsubscribe**, never
`off(path)` — `off` detaches every listener at that path and so takes down any overlapping
subscription. This bit `subscribeToSession`, `subscribeToSavedFiles` and `subscribeToTeamMembers` in
turn; do not reintroduce it.

### Key data model: three item states

Item ids are producer-supplied strings and carry no guaranteed shape — **do not split one on `.` to
find its section.** What a section is, and which section an item belongs to, is decided by
`lib/sectioning.ts:resolveSections` (see Sectioning below) and looked up through `sectionKeyOf`.
`parseQAFile` accepts both `"results"` and `"result"`, and de-duplicates repeated ids by appending
`.1`, `.2`, … — which injects a `.` into those ids, and is why `chooseIdDelimiter` requires its
delimiter to appear in *every* id rather than watching for a drop in bucket count.

Every item is in exactly one of three states. **Only `approved` is stored** — the other two are
derived, and approval wins over both:

| State | Derivation |
|---|---|
| `approved` | `itemStatus[id] === "approved"` |
| `unanswered` | not approved, `isUnanswered(item.answer)`, and no `editedAnswers[id]` |
| `ready` | everything else — answered, not signed off |

**`itemStatus` replaced a boolean `approvals` node**, and rooms written before that rename still hold
`approvals`. `subscribeToSession` folds it in through `mapLegacyApprovals` — `"approved"` is a
generalization of that `true`, so the mapping is total and no sign-off is lost to the rename. It is
read-only and never written back, so an untouched room keeps its old node and stays readable by any
build still on the old name; a room is only rewritten under `itemStatus` once somebody actually approves
or withdraws in it. **Do not drop that fallback** — it is the only thing standing between the rename and
every approval recorded before it.

`isUnanswered` (`lib/utils.ts`) is a prefix test on `"The provided context does not contain"`.

The bands are disjoint and sum to `itemCount`, which is what lets `ProgressWheel` draw them as one
ring. `computeProjectStats` in `lib/projects.ts` is the single implementation — `SectionGroup` mirrors
the same three buckets for its header badges. **Ratings are independent of approval**: a five-star
answer nobody approved is still `ready`. Do not derive approval from stars.

A human filling a blank makes it `ready`, not `unanswered` — that is why the dashboard needs
`editedAnswers` and not just `itemStatus`.

Unanswered items still have rating disabled (greyed stars).

### Who may approve

**Approving a question is the section reviewer's alone.** `SectionGroup` computes one
`approveDisabledReason` for the whole section — the reviewer is a property of the section, not of a
question, so every card in it gets the same answer — and `QuestionCard` disables Approve and shows that
string as both the hint text and the tooltip. Two cases block it:

- `sectionReviewers[section]` is unset — **nobody** can approve. An unreviewed section is closed, not
  open: with no reviewer named there is nobody whose sign-off it would be.
- it is set to someone else — only that person can, named in the message.

**Withdrawing approval is deliberately not gated**: anyone signed in can reopen a question, so a stale
approval never waits on whoever happens to hold the reviewer field. Do not "fix" that asymmetry — it is
the requested behaviour. It is **confirmed** instead, through a modal (`confirmingWithdraw` in
`QuestionCard`, mirroring the revert-to-original one): the click is open to everyone, it undoes a
sign-off that may not be the clicker's, and only the reviewer can put it back — so the dialog says
exactly that.

**An approved answer is frozen.** Every writer of `editedAnswers` on the card is withdrawn while
`approved` is true — the Edit response link, Edit again, and Revert to original — and a muted
`p-icon--lock-locked` line stands where the Edit control was, pointing at Withdraw approval as the way
back. Sign-off is on the exact text that was signed off on; letting the text change underneath would
leave an approval standing over words the reviewer never read. Approval also arrives over the live
session, so `QuestionCard` has an effect that closes an open editor (and any revert dialog) when
`approved` flips true: refusing to *open* the editor is not enough when someone else can approve
mid-edit. **A draft in progress is discarded** in that case; the alternative is a Save button that
writes over an approved answer. Copy is untouched, and so are **ratings** — a rating is an opinion about
an answer, not a change to it, and the two have always been independent (see the state table above).

The signed-in user's `TeamMember.id` comes from the `me` memo in `AppShell`, which matches `userEmail`
against the team bank rather than sanitizing the email into a key locally (that would be a second copy
of `teamBank`'s codec). It is passed to `SectionGroup` as `myMemberId` and is `undefined` until the bank
snapshot lands, so cards start disabled and enable a moment later rather than the reverse.

**This is a UI restriction, not an enforced one.** `database.rules.json` lets any authenticated
`@canonical.com` user write any `sessions/<id>/itemStatus` child, and the rule cannot express this
check: it would have to derive the section key from the item id, and RTDB rules have no string split.
Enforcing it in the database would mean re-keying `itemStatus` as `<section>/<item>` so a rule could
reach `sectionReviewers/$section` — a data migration, not a rules edit.

### Context URLs are read-only

`contextUrls` has **no writer left**. Unanswered questions used to carry a "Context source URL" input
at the bottom of the card, beside the rating, and it was removed from the UI; `updateContextUrl` /
`clearContextUrl` went with it. What remains is the read path, deliberately: the map is still seeded by
`ensureSession`, decoded by `subscribeToSession`, badged in a card's header row when a URL is present,
and written to the CSV's `Context URL` column. That keeps URLs attached before the removal visible and
exported instead of silently vanishing, and keeps the export's column layout stable for anything
consuming it. Do not add a new writer without being asked — removing the input was the request.

### Assignment

**A section is the unit of assignment.** Three independent things can point at a `TeamMember.id`:

- `sessions/<id>/sectionAssignees` — per section, who answers it; self-serve or lead-assigned
- `sessions/<id>/sectionReviewers` — per section, who reviews it; independent of who answers
- `sessions/<id>/projectAssignees` — `{ TeamMember.id: true }`, the project's owners, multi-owner,
  lead-assigned, **no cascade to sections** — but they *gate* who the sections may name (below)

The section pair are single values, **not** fan-out writes to every item in the section.

**Owners are edited from two places, one node.** The dashboard's `TeamMemberMultiSelect` on each card
or row, and the Collab UI header's **Manage Team Members** panel (`ProjectTeamPanel`) for the open
project. Both write `sessions/<id>/projectAssignees` through `setProjectAssignees`, so the two stay in
step live and neither is a cache of the other. **Do not add a third store for this.** Note what the two
Removes mean: unassigning in `ProjectTeamPanel` touches only that project, whereas Remove in the
dashboard's `ManageUsersPanel` deletes the person from the bank and reverts their assignments
everywhere (`revertAssignmentsForMember`).

**A project's owners are the only people its sections may be handed to.** `AppShell`'s
`assignableMembers` memo filters the team bank down to `projectAssignees`, and that — not the bank — is
what the two `TeamMemberSelect`s in `SectionGroup` offer. It is also what `ProjectTeamPanel` lists, so
the header's roster and the pickers it gates cannot disagree. Work flows through the project, not around it:
a section naming somebody who is not on the project at all used to be possible and said nothing about
which of the two was wrong.

Three consequences, each deliberate:

- **An unowned project has nobody to give its sections to.** The list is empty and a hint points at the
  Overview dashboard (`emptyHint` on `TeamMemberSelect`). This is the same shape as the reviewer gate —
  an unstaffed project is closed, not open — and it does mean every project predating this rule is
  unassignable until a lead sets its owners. Falling back to the whole bank would undo the restriction on
  exactly the projects nobody has staffed.
- **`SectionGroup` still receives the full `teamMembers` bank alongside `assignableMembers`**, because
  `approveDisabledReason` has to turn `sectionReviewers[section]` into a name even when that person is no
  longer an owner. Filtering the one prop instead of adding a second would have left that message saying
  "this section's reviewer".
- **Removing an owner does not clear their section assignments**, and `optionsFor` in `SectionGroup`
  unions the offered list with whoever the field currently names. That is not a loophole — it is what
  keeps the rule reversible: `TeamMemberSelect` resolves its trigger label from the list it was given, so
  a dropped owner would otherwise read "Unassigned" while still storing their id, leaving the section
  looking free when it was not, with no way to clear it. Nobody new can be added from outside the owners
  either way.

Like the approval gate, **this is a UI restriction and RTDB rules do not enforce it** — a rule would have
to cross-reference `projectAssignees` from a `sectionAssignees` write, which is expressible, but the
existing gate is unenforced for the same reason and doing one and not the other would be misleading.

There is deliberately **no per-question assignment**. `SessionState` used to carry `assignees` and
`reviewers` keyed by `item.id`, written by a pair of selects inside every `QuestionCard`, and they were
removed: a question could name a different owner than the section it sits in, with nothing to say which
of the two was meant. Do not reintroduce them — a section-level control that wrote to every item would
turn one choice into N writes and fight the section field for the same answer. Session nodes written
before the removal still hold those two maps; nothing reads them, `subscribeToSession` does not decode
them, and `revertAssignmentsForMember` does not clear them, so a departed member's id can linger there
invisibly.

The obsolete item-keyed nodes are left in place, neither read nor migrated, and **the path is deliberately not reused**: an item id and a section key can both be `"3"`, so writing section assignment there would resurrect a question-level assignment onto a section. A room still holding them is what `reportAlgoMismatch` reports on — they predate `sectionAlgoVersion`, so the version check alone cannot see them.

`revertAssignmentsForMember` (`lib/session.ts`) clears all three when a member leaves the bank. It
deliberately does **not** touch `itemStatus`, which holds only `"approved"` and no member id: clearing
it would withdraw sign-offs across every project because one person left. Revoking a departed member's
approvals would need the approver recorded alongside the status.

Note `SectionGroup` used to show the assignee and reviewer of a section's *first item* as if they were
the section's own, as read-only text — so a section could not be assigned at all, and whoever it named
changed whenever question one changed hands. Both are now real `TeamMemberSelect`s over
`sectionAssignees` / `sectionReviewers`. The `assignee:` / `reviewer:` values in `FilterBar`'s person
filter read those same two maps, so filtering by a person selects their whole sections.

`sectionReviewers` is not in `ProjectOverlays`: the dashboard shows owners and progress, and
`MyAssignments` lists sections from `sectionAssignees` alone, so a sixth listener per project would buy
nothing. Adding it is a one-line change to `OVERLAY_KEYS` if the dashboard ever needs it.

`MyAssignments` therefore lists **sections and project ownership only**. It used to also badge each row
with a member's outstanding and approved *questions*; counting the questions inside their sections
instead would need a per-section item count, which is not denormalized into `savedFiles` metadata — and
loading a document to work it out is what the bandwidth rule above forbids.

### Team bank

`/teamMembers/<sanitizedEmail>` → `{ name, email, photoURL, createdAt }`. Global, not per-project; any
authenticated `@canonical.com` user can add or remove. `ensureTeamMember` writes an entry on first
sign-in. `lib/teamBank.ts` also has `subscribeToTeamMembers` and `removeTeamMember`.

Pass `teamMembers` down from `AppShell` rather than subscribing again in a new component.

**`findMemberByEmail(teamMembers, email)` is the one answer to "which member am I".** `AppShell`'s `me`
memo and `OverviewView`'s both call it; they used to carry a copy of the same `find` each. It matches on
email rather than sanitizing the address into a key locally — `sanitizeEmailKey` is private on purpose,
and a second caller would not only duplicate the codec but mint an id for somebody the bank has no
record of. Three things it is careful about, each with a plausible-looking wrong answer:

- **An empty address matches nobody.** `subscribeToTeamMembers` normalizes a missing `email` child to
  `''` and `AuthGate` passes `user.email ?? ""`, so a bare `===` pairs a user with no address to
  whichever record is missing one — and shows them a stranger's assignments.
- **Exact case beats a case-insensitive match.** The bank is keyed by the sanitized address, so
  `Alice@…` and `alice@…` are two keys and two ids, and `ensureTeamMember` writes whatever the provider
  returned. Where both exist, a plain case-insensitive `find` returns whichever RTDB enumerated first
  and assignments against the other id silently vanish.
- Whitespace is trimmed on both sides.

**`MyAssignments` distinguishes three states, not two.** A null `me` means either "the bank has not
arrived" or "you are genuinely not in it", and they need different words — `identityPending` (`!me &&
userEmail && teamMembers.length === 0`) separates them, and an empty bank is the former because
`ensureTeamMember` writes an entry on first sign-in. Likewise `overlaysPending` gates the "nothing is
assigned to you" line, because a project waiting on its overlays is indistinguishable from one nobody
is assigned to: saying "nothing" early is not a slower right answer, it is the wrong one. The list also
names the person it belongs to, so a wrong identity is visible rather than plausible.

`lib/session.ts` also exports `revertAssignmentsForMember(memberId)`, which scans every room under
`/sessions` and clears any `sectionAssignees`/`sectionReviewers` entry pointing at the removed member,
reverting those sections to "Unassigned". Called whenever a member leaves the team bank, so a removed
person's name cannot go on being the reviewer who has to approve a section.

### Sectioning

`lib/sectioning.ts:resolveSections` decides what a section is, in three tiers:

1. an explicit per-item `section` label
2. hierarchical ids — the delimiter is chosen from `. - _ : / space`, requiring the delimiter to appear
   in **every** id and then preferring the fewest buckets
3. TextTiling-style contiguous topic inference, for files with no section signal at all (flat ids like
   `1..56`)

Inference is sequential rather than clustered so it is deterministic: collaborators in one live session
must derive byte-identical sections from the same file. Every section is capped at `SECTION_CAP` (10)
questions, **softly** — a trailing part below 5 folds back into the one before it, so 34 becomes
10/10/14.

Resolve the map **once per file, memoised on `data`** — never over a filtered subset. Boundaries derived
from a filtered list would move as the user types, visibly rearranging sections and appearing to move
people's assignments. `groupBySection` and `sectionKeyOf` only ever look the map up.

Section keys are the primary key for assignment, and for inferred sections and split parts
(`inferred:2`, `3~2`) they are outputs of this file. **Bump `SECTION_ALGO_VERSION` whenever a change
there can re-key a section**, including any change to `SECTION_CAP`. The stamp is written into the room
at seed and compared on load; a mismatch cannot be repaired, but `reportAlgoMismatch` says so out loud
rather than letting the file read as though nobody was ever assigned — and it also fires for a room
still holding the obsolete item-keyed `assignees`/`reviewers`, which carries no stamp at all.

### Export and the archive

`lib/csv.ts` owns CSV building and downloading (`buildCsv`, `csvFilenameFor`, `downloadCsv`), shared by
`ExportButton` and by the dashboard's completed list so a re-download matches the original byte for
byte. Columns: `Question, Original Answer, Edited Answer, Context URL, Rating`; filename is the source
JSON name with `-export.csv`. `Context URL` is kept even though nothing can fill it any more — see
"Context URLs are read-only" above.

`downloadCsv` returns whether the download was *initiated* — a browser gives no completion callback —
and that is what gates the removal step of Export-and-remove.

On **both** export paths `runExport` also archives the project and stamps the `savedFiles` record.
Neither is awaited and neither blocks the export: the CSV is already on its way to disk.

`/archivedProjects` is split in two on purpose:

```
archivedProjects/index/<pushId>    -> filename, exportedBy, exportedByEmail, exportedAt,
                                      itemCount, sourceSessionId
archivedProjects/payloads/<pushId> -> data, editedAnswers
```

RTDB returns a whole subtree for any path you read, so nesting alone saves nothing — only reading a
*different path* does. Held flat, listing completed projects would transfer every archived document,
and unlike `savedFiles` the archive is never pruned. Split, the list reads `index` and stays small
forever; a document is fetched (`getArchivedPayload`) only when someone asks to re-download it. Both
halves are written in one multi-path `update`, so an entry cannot be listed without its payload.

The completed list enumerates the archive, **not `/sessions`** — `/sessions` keeps a node per document
ever opened and never sheds one, so listing it would show every abandoned project as finished.

**Each entry carries a reported deal outcome: `dealStatus: "won" | "lost" | "pending"`**, written by the
`<select>` on its row through `setDealStatus`. A missing child reads as `"pending"` — "nobody has said
yet" is exactly what pending means — so there is nothing to migrate and no entry without a status.
`toDealStatus` also folds an *unrecognised* value to pending rather than trusting it into the type.

**`archiveProject` writes the index entry one field per path, and that is load-bearing.** An `update`
whose value is a whole object replaces that child, and because an entry is keyed by project, a
re-export overwrites the entry already there — which would silently discard `dealStatus`, a field that
function knows nothing about. Per-field paths merge, so a reported outcome survives a re-export.
`payloads/<id>` stays a whole-object write (it *is* the document, and a fresh export replaces it by
design), and both halves are still one atomic `update`.

`setDealStatus` uses a plain `update`, which creates the node when absent, so `listArchivedProjects`
filters entries with no `filename` or no `exportedAt` — the same guard `listProjectMetas` has, against
the same ghost. The archive is never pruned by the app, so this can only bite if an entry is deleted in
the console mid-click.

The dashboard patches `archived` locally and **reverts on failure**, unlike the session writes in
`AppShell` which leave the change on screen behind a toast. Those are edits a reader can see for
themselves in the document; a deal status is a single word whose only evidence is the control, and left
showing "Won" after a failed write it would be indistinguishable from a saved "Won".

The section's **one filter spans two axes** — Record status (Open for revision / Archived — export only)
and Deal outcome — separated by `<optgroup>`s. It is "Record status" rather than "Status" because the
dashboard above already has a Status filter over *active* projects, and two controls on one screen
labelled the same thing filtering different populations is worse than a longer word. Record status reads
`liveProjectIds`, never the entry: whether
a finished project can be reopened depends on whether its `savedFiles` record still exists, which
export-and-remove decides *after* the entry is written, so nothing on the entry could know.

`.completed-row` is a **grid with fixed tracks**, not a flex row, for the same reason and by the same
rule as `.project-list__row`: flex sized every cell from its own content, so the columns started at a
different x on each line and long dates and names sat clipped inside an 8rem box. Widths are
`--completed-col-*` custom properties on `.completed-list`, each sized to hold its widest realistic
content whole — so a value that does not fit means a track to widen, not something to ellipsize.
**`--completed-col-name` is the only elastic track**; a second `1fr` would split the slack and take the
alignment with it. The exporter column appears only above `85rem`, and the template gains its track in
the same media query that stops hiding the cell — doing one without the other leaves an empty column or
overflows the row. Below `60rem` the row wraps, as the project list's does.

The status `<select>` is typed `select.completed-row__status` (0,1,1), not on the class alone: every
metric it sets is one Vanilla already sets on a bare `select` (0,1,0), and the background is restated at
`select:hover` (0,1,1), which a single class would lose to on hover. Only `background-color` is
touched, never `background` — the chevron is a `background-image` on the same element and the shorthand
would take it with it. The three tints are the app's own `positive` / `negative` / `caution`, so a
colour means the same thing here as on a question card; `information` (blue) is deliberately unused, as
it reads "in progress" and a finished project's deal is not.

### Static export constraint

`next.config.js` sets `output: 'export'`. No API routes, no server components, no server actions, no
dynamic routes — all aggregation happens in the browser, and new screens are client views inside
`AppShell`, not routes. Navigation is `history.replaceState` on query params (`syncDocParam`).

### Component tree

```
page.tsx
└── AuthGate — Firebase auth state listener
    ├── LoginScreen
    └── AppShell (document state, view switching)
        ├── Sidebar — Overview / Collaborative UI / RFP Database, dark mode, user, sign out
        ├── Header — hidden on Overview
        │   ├── ProjectTeamPanel — "Manage Team Members": the open project's roster, add/remove,
        │   │                      writes sessions/<id>/projectAssignees (NOT the global bank)
        │   ├── FileLoader — upload or pick a saved project; remove
        │   ├── ShareButton — copies the ?doc= link
        │   ├── ExportButton — CSV, archive, optional export-and-remove
        ├── OverviewView — the dashboard (own state; metadata + overlay subscriptions)
        │   ├── ManageUsersPanel — "Manage Users": the global team bank, add/remove people from the
        │   │                       tool itself. Moved here from the header; removing runs
        │   │                       removeTeamMember + revertAssignmentsForMember
        │   ├── ModeToggle ×1 — All projects / My assignments (underline tabs, brand bar)
        │   ├── ProjectSummaryStrip — totals, in progress, approved, overdue, archived
        │   ├── [sort / owner / status controls, Cards/List ModeToggle, bulk-assign bar]
        │   ├── ProjectCard (per active project, in a responsive grid — "cards" view)
        │   │   ├── ProgressWheel — three hoverable bands, custom SVG
        │   │   ├── DueDateField — inline date editing
        │   │   └── TeamMemberMultiSelect — project owners
        │   ├── ProjectListRow (per active project, one line each — "list" view)
        │   │   ├── [ApprovedBar] — local to the file; one metric, not three
        │   │   └── TeamMemberMultiSelect — project owners
        │   ├── CompletedProjectsList — archive rows; reopen or regenerate CSV
        │   └── MyAssignments — the signed-in user's sections + owned projects
        ├── [live session banner]
        ├── FilterBar — status toggle, section/person dropdown, search
        ├── SectionGroup (per section)
        │   ├── TeamMemberSelect ×2 — section assignee + reviewer, offered from the project's owners
        │   │                          (sectionAssignees / sectionReviewers)
        │   ├── [collapse toggle] — hides this section's cards; per doc, via lib/expansion.ts
        │   └── QuestionCard (per item) — no assignment controls; see Assignment
        │       ├── CopyButton, StarRating
        │       ├── [expansion] — owned by AppShell (expandedIds), remembered per doc
        │       └── [Approve / Withdraw approval] — the only writer of itemStatus
        └── RfpDatabaseView — unrelated RFP search over /rfpDatabase
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

`database.rules.json` defines RTDB access rules for `/sessions`, `/teamMembers`, `/savedFiles`,
`/savedFileData`, `/rfpDatabase` and `/archivedProjects` — all restricted to authenticated
`@canonical.com` users — and `firebase.json` points the `database` deploy target at it.

**Rule changes are not live until deployed.** Run `firebase deploy --only database`, which requires
access to the `canonical-req-8605` Firebase project.

Two nodes are new and both fail closed until that deploy lands:

- `/savedFileData` — **deploy before shipping this build.** Documents live here, so without the rule
  every upload is rejected outright (the multi-path write is atomic, so nothing is half-saved and the
  loader reports it), and opening an already-migrated project finds no document.
- `/archivedProjects` — archive writes are rejected, so exports download their CSV but the completed
  list stays empty and says so.
