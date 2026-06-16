"use client";

import type { Filters, FilterStatus } from "@/lib/types";

interface Props {
  filters: Filters;
  sections: string[];
  onChange: (filters: Filters) => void;
  resultCount: number;
  totalCount: number;
}

const STATUS_OPTIONS: { value: FilterStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "answered", label: "Answered" },
  { value: "unanswered", label: "Unanswered" },
];

export default function FilterBar({
  filters,
  sections,
  onChange,
  resultCount,
  totalCount,
}: Props) {
  const hasActiveFilters =
    filters.status !== "all" || filters.section !== "" || filters.search !== "";

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

        {/* Status toggle buttons */}
        <div className="p-segmented-control filter-bar__status">
          <div className="p-segmented-control__list">
            {STATUS_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setStatus(value)}
                aria-pressed={filters.status === value}
                className={`p-segmented-control__button u-no-margin--bottom ${
                  filters.status === value
                    ? value === "unanswered"
                      ? "p-button--negative"
                      : value === "answered"
                      ? "p-button--positive"
                      : "p-button--brand"
                    : "p-button--base"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Section dropdown */}
        <select
          value={filters.section}
          onChange={(e) => setSection(e.target.value)}
          className="u-no-margin--bottom filter-bar__select"
        >
          <option value="">All sections</option>
          {sections.map((sec) => (
            <option key={sec} value={sec}>
              Section {sec}
            </option>
          ))}
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
