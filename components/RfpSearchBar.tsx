"use client";

interface Props {
  query: string;
  onQueryChange: (query: string) => void;
  dateFilter: string;
  onDateFilterChange: (date: string) => void;
  availableDates: string[];
}

export default function RfpSearchBar({
  query,
  onQueryChange,
  dateFilter,
  onDateFilterChange,
  availableDates,
}: Props) {
  return (
    <div className="rfp-search-bar">
      <div className="rfp-search-bar__input-wrap">
        <input
          type="search"
          placeholder="Search questions and answers…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="u-no-margin--bottom"
        />
      </div>
      <select
        value={dateFilter}
        onChange={(e) => onDateFilterChange(e.target.value)}
        className="u-no-margin--bottom rfp-search-bar__date"
      >
        <option value="">All dates</option>
        {availableDates.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </div>
  );
}
