## ADDED Requirements

### Requirement: RFP Q&A records stored in Firebase RTDB
The system SHALL store RFP Q&A records under `/rfpDatabase/{recordId}` in Firebase Realtime Database. Each record SHALL contain: `question` (string), `answer` (string), `source` (string), `rfpDate` (string, ISO 8601 date), and `importedAt` (number, epoch milliseconds).

#### Scenario: Record structure is valid
- **WHEN** a record exists at `/rfpDatabase/{recordId}`
- **THEN** it SHALL contain all required fields: `question`, `answer`, `source`, `rfpDate`, and `importedAt`

#### Scenario: Multiple records coexist
- **WHEN** the import script writes 1,000 records to `/rfpDatabase`
- **THEN** each record SHALL have a unique Firebase push key as its `recordId`

### Requirement: Access restricted to authenticated canonical.com users
The system SHALL restrict read and write access to `/rfpDatabase` to authenticated users with `@canonical.com` email addresses, enforced via Firebase RTDB security rules.

#### Scenario: Authenticated canonical.com user reads database
- **WHEN** an authenticated user with a `@canonical.com` email requests `/rfpDatabase`
- **THEN** the read SHALL succeed and return all records

#### Scenario: Unauthenticated user is denied
- **WHEN** an unauthenticated request targets `/rfpDatabase`
- **THEN** the request SHALL be rejected by Firebase security rules

#### Scenario: Non-canonical.com user is denied
- **WHEN** an authenticated user with a non-`@canonical.com` email requests `/rfpDatabase`
- **THEN** the request SHALL be rejected by Firebase security rules

### Requirement: Import script seeds RTDB from sheet export
The system SHALL provide a Node.js script at `scripts/import-rfp-data.ts` that reads a CSV export from Google Sheets and writes all rows to `/rfpDatabase`, replacing any existing data.

#### Scenario: Successful import from CSV
- **WHEN** the script is run with a valid CSV file containing columns `question`, `answer`, `source`, and `rfpDate`
- **THEN** all rows SHALL be written to `/rfpDatabase` with Firebase push keys, and each record SHALL include an `importedAt` timestamp

#### Scenario: Re-import overwrites existing data
- **WHEN** the script is run against an `/rfpDatabase` path that already contains records
- **THEN** the existing records SHALL be replaced with the new import data

#### Scenario: Invalid CSV is rejected
- **WHEN** the script is run with a CSV missing required columns
- **THEN** the script SHALL exit with an error message listing the missing columns
