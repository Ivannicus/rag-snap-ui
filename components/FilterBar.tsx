"use client";

import React, { useState } from "react";
import { addTeamMember, removeTeamMember } from "@/lib/teamBank";
import { revertAssignmentsForMember } from "@/lib/session";
import type { Filters, FilterStatus, TeamMember } from "@/lib/types";

interface Props {
  filters: Filters;
  sections: string[];
  onChange: (filters: Filters) => void;
  resultCount: number;
  totalCount: number;
  teamMembers: TeamMember[];
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
  teamMembers,
}: Props) {
  const [managingUsers, setManagingUsers] = useState(false);
  const [newName, setNewName] = useState("");

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

  function handleAddMember() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    addTeamMember(trimmed);
    setNewName("");
  }

  function handleRemoveMember(memberId: string) {
    removeTeamMember(memberId);
    revertAssignmentsForMember(memberId);
  }

  return (
    <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row gap-3 items-start sm:items-center">

        {/* Status toggle buttons */}
        <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden shrink-0">
          {STATUS_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setStatus(value)}
              className={`
                px-3 py-1.5 text-sm font-medium transition-colors
                ${filters.status === value
                  ? value === "unanswered"
                    ? "bg-red-500 text-white"
                    : value === "answered"
                    ? "bg-green-500 text-white"
                    : "bg-blue-600 text-white"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                }
              `}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Section dropdown */}
        <select
          value={filters.section}
          onChange={(e) => setSection(e.target.value)}
          className="text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All sections</option>
          {sections.map((sec) => (
            <option key={sec} value={sec}>
              Section {sec}
            </option>
          ))}
        </select>

        {/* Search input */}
        <div className="relative flex-1 min-w-0">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search questions and answers…"
            value={filters.search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-8 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {filters.search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Result count + clear */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
            {resultCount} / {totalCount}
          </span>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Manage users toggle */}
        <button
          onClick={() => setManagingUsers((m) => !m)}
          className={`
            shrink-0 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors
            ${managingUsers
              ? "border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20"
              : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            }
          `}
        >
          Manage Users
        </button>
      </div>

      {/* Manage users panel */}
      {managingUsers && (
        <div className="max-w-5xl mx-auto mt-3 flex flex-col gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddMember(); } }}
              placeholder="Add team member name"
              className="flex-1 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleAddMember}
              disabled={!newName.trim()}
              className="shrink-0 px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white transition-colors"
            >
              Add
            </button>
          </div>
          {teamMembers.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {teamMembers.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 text-sm text-gray-700 dark:text-gray-300 px-1">
                  <span className="truncate">{m.name}</span>
                  <button
                    onClick={() => handleRemoveMember(m.id)}
                    title="Remove from team bank"
                    className="shrink-0 p-1 rounded text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500 px-1">No team members yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
