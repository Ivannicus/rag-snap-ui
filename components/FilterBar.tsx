"use client";

import ModeToggle from "./ModeToggle";
import type { Filters, FilterStatus, PersonFilterOption, SectionInfo } from "@/lib/types";

interface Props {
  filters: Filters;
  sections: SectionInfo[];
  personFilterOptions: PersonFilterOption[];
  onChange: (filters: Filters) => void;
  resultCount: number;
  totalCount: number;
}

// "Approved" means human-approved, not "the model produced an answer". Questions that have an answer
// nobody has signed off on yet are only reachable through "All".
const STATUS_OPTIONS: readonly { value: FilterStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "approved", label: "Approved" },
  { value: "unanswered", label: "Unanswered" },
];

export default function FilterBar({
  filters,
  sections,
  personFilterOptions,
  onChange,
  resultCount,
  totalCount,
}: Props) {
  const hasActiveFilters =
    filters.status !== "all" || filters.section !== "" || filters.search !== "";

  const assignmentOptions = personFilterOptions.filter((opt) =>
    opt.value.startsWith("assignee:")
  );
  const reviewOptions = personFilterOptions.filter((opt) =>
    opt.value.startsWith("reviewer:")
  );

  function setStatus(status: FilterStatus) {
    onChange({ ...filters, status });
  }

  function setSection(section: string) {
    onChange({ ...filters, section });
  }

  function setSearch(search: string) {
    onChange({ ...filters, search });
  }

  function clearFilters() {
    onChange({ status: "all", section: "", search: "" });
  }

  return (
    <div className="filter-bar-wrapper">
      <div className="filter-bar">

        {/* Status filter, as underline tabs like every other toggle in the app. The active bar takes
            the status's own colour — orange for All, green for Approved, red for Unanswered, the
            colours the segmented buttons used to fill with — through the `--<status>` modifier, which
            sets `--underline-tabs-bar` for whichever tab is selected. */}
        <ModeToggle
          ariaLabel="Filter questions by status"
          options={STATUS_OPTIONS}
          value={filters.status}
          onChange={setStatus}
          className={`filter-bar__status filter-bar__status--${filters.status}`}
        />

        {/* Section dropdown */}
        <select
          value={filters.section}
          onChange={(e) => setSection(e.target.value)}
          className="u-no-margin--bottom filter-bar__select"
        >
          <option value="">All sections</option>
          {assignmentOptions.length > 0 && (
            <optgroup label="Filter by assignment">
              {assignmentOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </optgroup>
          )}
          {reviewOptions.length > 0 && (
            <optgroup label="Filter by review">
              {reviewOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Filter by section">
            {/* sec.label already reads as a heading ("Section 3.2", "Active Directory"), so it is
                rendered verbatim rather than prefixed here. */}
            {sections.map((sec) => (
              <option key={sec.key} value={sec.key}>
                {sec.label}
              </option>
            ))}
          </optgroup>
        </select>

        {/* Search input */}
        <div className="p-search-box filter-bar__search">
          <input
            type="search"
            placeholder="Search questions and answers…"
            value={filters.search}
            onChange={(e) => setSearch(e.target.value)}
            className="p-search-box__input"
          />
          {filters.search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="p-search-box__reset"
            >
              <i className="p-icon--close">
                <span className="u-off-screen">Clear search</span>
              </i>
            </button>
          )}
        </div>

        {/* Result count + clear */}
        <div className="filter-bar__results">
          <span className="u-text--muted p-text--small">
            {resultCount} / {totalCount}
          </span>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="p-button--link u-no-margin--bottom"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
