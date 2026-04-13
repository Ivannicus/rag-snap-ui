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

RAG Snap UI is a **purely client-side** Next.js app (no server routes, no API calls) for inspecting and editing RAG (Retrieval-Augmented Generation) Q&A result files. Users load a JSON file, browse questions grouped by section, filter/search results, inline-edit answers, and export the modified JSON.

## Architecture

All state lives in `app/page.tsx` (the single route). It manages:
- `data: ParsedQAFile | null` — the loaded file's items
- `editedAnswers: Record<string, string>` — a map of `item.id → edited text` (edits are ephemeral, not persisted to localStorage)
- `filters: Filters` — status/section/search state passed down to `FilterBar`
- `darkMode: boolean` — persisted to `localStorage`

State flows down as props; no context or state management library is used.

### Key data model

Items have `id` strings in `"section.question"` format (e.g. `"1.2"`, `"3.10"`). Section grouping is derived by splitting on `.` and taking index 0. An answer is considered "unanswered" if it starts with `"The provided context does not contain"` (see `lib/utils.ts:isUnanswered`).

The JSON format supports both `"results"` and `"result"` keys (handled in `lib/utils.ts:parseQAFile`).

### Component tree

```
page.tsx (all state)
├── Header — sticky bar with FileLoader, file metadata, answered/unanswered counts
│   └── FileLoader — drag-and-drop or click-to-upload, calls parseQAFile
├── FilterBar — status toggle, section dropdown, search input
└── SectionGroup (per section)
    └── QuestionCard (per item)
        └── CopyButton
ExportButton — serializes data + editedAnswers to JSON download
```

`QuestionCard` manages its own local UI state (open/collapsed, editing draft) but calls `onSaveEdit`/`onClearEdit` in page.tsx to persist edits.

### Tailwind & dark mode

Dark mode is class-based (`dark:` variants). The `"dark"` class is toggled on `<html>` via `useEffect` in `page.tsx`. All components use Tailwind only — no CSS modules or styled-components.
