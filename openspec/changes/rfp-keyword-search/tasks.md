## 1. Data Model & Firebase Rules

- [x] 1.1 Add `RfpRecord` type to `lib/types.ts` with fields: `id`, `question`, `answer`, `source`, `rfpDate`, `importedAt`
- [x] 1.2 Update `database.rules.json` to add `/rfpDatabase` path with read/write restricted to authenticated `@canonical.com` users

## 2. Import Script

- [x] 2.1 Create `scripts/import-rfp-data.ts` that reads a CSV file (columns: question, answer, source, rfpDate), validates required columns, and writes all rows to `/rfpDatabase` using Firebase Admin SDK with push keys and `importedAt` timestamps
- [x] 2.2 Add a `scripts/README.md` with usage instructions for the import script (dependencies, service account setup, run command)

## 3. RFP Database Data Layer

- [x] 3.1 Create `lib/rfpDatabase.ts` with `subscribeToRfpDatabase(onUpdate)` that reads `/rfpDatabase` via `onValue` and returns `RfpRecord[]`
- [x] 3.2 Add a `searchRfpRecords(records, query, dateFilter?)` utility function to `lib/rfpDatabase.ts` that performs case-insensitive substring matching on `question` and `answer` fields, and optionally filters by `rfpDate`

## 4. View Toggle in App Shell

- [x] 4.1 Add `activeView: "inspector" | "database"` state to `AppShell.tsx`
- [x] 4.2 Add toggle buttons in the Header component to switch between "File Inspector" and "RFP Database" views
- [x] 4.3 Conditionally render the existing file-inspection content or the new RFP Database view based on `activeView`

## 5. RFP Database Search UI

- [x] 5.1 Create `components/RfpDatabaseView.tsx` — container component that loads data from `/rfpDatabase` on mount, manages search query and date filter state, and passes filtered results to child components
- [x] 5.2 Create `components/RfpSearchBar.tsx` — search input and date filter controls
- [x] 5.3 Create `components/RfpResultCard.tsx` — displays a single search result with question, answer, source, and RFP date
- [x] 5.4 Create `components/RfpResultsList.tsx` — renders the list of `RfpResultCard` components with result count, empty-state message, and loading indicator
- [x] 5.5 Display "Last imported" freshness timestamp derived from the max `importedAt` across loaded records

## 6. Styling

- [x] 6.1 Add styles for the view toggle, search bar, result cards, and date filter to `app/globals.scss` using Vanilla Framework patterns and custom classes
- [x] 6.2 Verify dark mode support — all new components use Vanilla Framework CSS variables, inheriting dark mode via `is-dark` on `<html>`

## 7. Verification

- [x] 7.1 Build the project (`npm run build`) with no type errors
- [ ] 7.2 Manual test: toggle between views, search keywords, filter by date, verify result cards, check dark mode, confirm empty states
