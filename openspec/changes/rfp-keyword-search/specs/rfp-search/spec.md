## ADDED Requirements

### Requirement: App shell supports view toggle
The system SHALL provide a toggle in the header to switch between "File Inspector" (existing view) and "RFP Database" (new search view). The default view SHALL be "File Inspector".

#### Scenario: User switches to RFP Database view
- **WHEN** the user clicks the "RFP Database" toggle in the header
- **THEN** the main content area SHALL display the RFP search interface instead of the file-inspection view

#### Scenario: User switches back to File Inspector
- **WHEN** the user clicks the "File Inspector" toggle while viewing the RFP Database
- **THEN** the main content area SHALL return to the file-inspection view with all prior state preserved

### Requirement: RFP database loads on view activation
The system SHALL load all records from `/rfpDatabase` into memory when the user first navigates to the RFP Database view. The data SHALL be fetched once and cached in component state for the duration of the session.

#### Scenario: Initial load succeeds
- **WHEN** the user opens the RFP Database view for the first time
- **THEN** the system SHALL fetch all records from `/rfpDatabase` and display a count of total records

#### Scenario: Loading state is shown
- **WHEN** the RTDB fetch is in progress
- **THEN** the UI SHALL display a loading indicator

#### Scenario: Empty database
- **WHEN** `/rfpDatabase` contains no records
- **THEN** the UI SHALL display a message indicating the database is empty

### Requirement: Keyword search across questions and answers
The system SHALL provide a search input that filters loaded records by keyword. The search SHALL be case-insensitive and match against both the `question` and `answer` fields using substring matching.

#### Scenario: Search matches in question field
- **WHEN** the user types "security" in the search input
- **THEN** the results SHALL include all records where `question` contains "security" (case-insensitive)

#### Scenario: Search matches in answer field
- **WHEN** the user types "encryption" in the search input
- **THEN** the results SHALL include all records where `answer` contains "encryption" (case-insensitive)

#### Scenario: Search matches across both fields
- **WHEN** a record has "firewall" in the question and another record has "firewall" in the answer
- **THEN** both records SHALL appear in results when searching for "firewall"

#### Scenario: No matches found
- **WHEN** the user searches for a term with no matches
- **THEN** the UI SHALL display a "No results found" message

#### Scenario: Empty search shows all records
- **WHEN** the search input is cleared
- **THEN** all loaded records SHALL be displayed

### Requirement: Date filter narrows results by RFP date
The system SHALL provide a date filter that restricts search results to records matching a selected RFP date or date range.

#### Scenario: Filter by specific date
- **WHEN** the user selects a specific RFP date
- **THEN** only records with a matching `rfpDate` SHALL be displayed

#### Scenario: Date filter combines with keyword search
- **WHEN** the user has both a keyword search and a date filter active
- **THEN** results SHALL match both the keyword AND the date criteria

#### Scenario: Clear date filter
- **WHEN** the user clears the date filter
- **THEN** results SHALL no longer be restricted by date (keyword filter still applies if active)

### Requirement: Search results display record details
The system SHALL display each matching record as a card showing the question, answer, source, and RFP date.

#### Scenario: Result card layout
- **WHEN** search results are displayed
- **THEN** each result card SHALL show the question as a heading, the answer as body text, the source as a link or label, and the RFP date

#### Scenario: Result count is shown
- **WHEN** a search or filter returns results
- **THEN** the UI SHALL display the count of matching records (e.g., "42 results")

### Requirement: Data freshness indicator
The system SHALL display the most recent `importedAt` timestamp from the loaded records so users know how current the data is.

#### Scenario: Freshness timestamp displayed
- **WHEN** the RFP Database view is loaded with data
- **THEN** the UI SHALL show "Last imported: <formatted date>" based on the maximum `importedAt` value across all records
