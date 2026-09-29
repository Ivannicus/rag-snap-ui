"use client";

import React, { useEffect, useRef, useState } from "react";
import TeamMemberMultiSelect from "./TeamMemberMultiSelect";
import { dateInputToIso } from "@/lib/dates";
import { lockPageScroll } from "@/lib/scrollLock";
import type { ParsedQAFile, TeamMember } from "@/lib/types";

/** What the modal was filled in with, handed back on submit. */
export interface NewProjectValues {
  /**
   * The project's name in the app, which the reader may have changed from the file's.
   *
   * Trimmed here rather than by the caller, because this is where the raw input is: a name is compared
   * against the bank for uniqueness on both submit paths, and `" report.json"` and `"report.json"`
   * would otherwise be two different projects that read as one.
   */
  filename: string;
  dueDate: string | null;
  ownerIds: string[];
}

interface Props {
  /**
   * The name the project arrives with — the picked file's, or the snap batch's. Already parsed by the
   * time this opens, see `readJsonFile`.
   *
   * It seeds the name field and is also shown as the source above it, so the two stay distinguishable
   * once the reader has renamed: the block says which file this came from, the field says what the
   * project will be called.
   */
  filename: string;
  data: ParsedQAFile;
  /**
   * The whole team bank, not the open project's owners.
   *
   * `assignableMembers` in `AppShell` is derived from whichever project is currently open, which has
   * nothing to do with the one being created. The dashboard's bulk-assign bar passes the full bank for
   * the same reason.
   */
  teamMembers: TeamMember[];
  /**
   * The creator's `TeamMember.id`, preselected, or null when they are not in the bank yet.
   *
   * Null is not worked around. `TeamMember.id` is a sanitized email and the codec that produces it
   * (`sanitizeEmailKey`) is private to `lib/teamBank.ts` on purpose, so deriving an id here would be a
   * second copy of it — and would risk storing an owner key nothing else in the app matches.
   * `ensureTeamMember` writes an entry on first sign-in, so in practice this is the moment before the
   * bank's first snapshot lands.
   */
  myMemberId: string | null;
  /** Why the last submit did not create anything, shown in place. Null while nothing has failed. */
  error: string | null;
  submitting: boolean;
  onSubmit: (values: NewProjectValues) => void;
  onCancel: () => void;
  /**
   * What backing out is called, when "Cancel" would understate it.
   *
   * The snap handoff's record is already saved by the time this modal opens, so backing out there
   * deletes it — "Discard batch", drawn as a negative action rather than a neutral one.
   */
  cancelLabel?: string;
}

/**
 * Configure a project before it is created: its name, its due date and its team.
 *
 * Built from the same `p-modal` skeleton as the remove-team-member and remove-file dialogs — the
 * house pattern, repeated near-verbatim in five places — so it needs no styling of its own beyond the
 * stacked field column. The one thing it adds that no other modal here has is Escape-to-close and a page
 * scroll lock; both are wanted for a form somebody may be part-way through, and neither is worth
 * retrofitting onto the seven existing confirmations as part of this change.
 */
export default function NewProjectModal({
  filename,
  data,
  teamMembers,
  myMemberId,
  error,
  submitting,
  onSubmit,
  onCancel,
  cancelLabel,
}: Props) {
  // All three seeded once, at mount. This modal is mounted fresh per open (`AppShell` renders it only
  // when a file is staged), so there is no stale draft to worry about and nothing to keep in step with
  // the props — the same reason `DueDateField` seeds its draft on open rather than from `value`.
  //
  // The name starts as the file's, which is what the project would have been called before this field
  // existed, so leaving it alone is the unchanged behaviour. Changing it renames the project *in the
  // app* only: the document is untouched, and so is the file on the reader's disk.
  const [nameInput, setNameInput] = useState(filename);
  const [dueDateInput, setDueDateInput] = useState("");
  const [ownerIds, setOwnerIds] = useState<string[]>(myMemberId ? [myMemberId] : []);

  // A project with no name has nothing to list it by, nothing to name its CSV after and nothing for the
  // bank's uniqueness check to compare — so an all-whitespace name is refused rather than stored and
  // rendered as a blank row. Trimmed here so the check and the value submitted are the same string.
  const trimmedName = nameInput.trim();
  const nameMissing = trimmedName === "";

  /**
   * Add the creator once the team bank arrives, if it had not arrived at mount.
   *
   * The seed above is enough when this modal is opened by hand: the bank loaded long before anyone
   * clicked New project. It is not enough on the snap handoff, where the modal *is* the landing screen
   * and mounts while `subscribeToTeamMembers` is still in flight — `myMemberId` is null for the first
   * render or two, and without this the creator would silently not be on their own project.
   *
   * Guarded twice so it cannot fight the user: the ref lets it fire at most once, and the length check
   * means it will not overwrite a selection already made — including a deliberately emptied one, since by
   * then the ref has been spent.
   */
  const seededOwner = useRef(myMemberId !== null);
  useEffect(() => {
    if (seededOwner.current || myMemberId === null) return;
    seededOwner.current = true;
    // The updater form, not a bare value: it reads the selection at the moment it runs, which is what
    // lets the length check below be a real guard rather than a stale snapshot from render.
    setOwnerIds((prev) => (prev.length === 0 ? [myMemberId] : prev));
  }, [myMemberId]);

  useEffect(() => lockPageScroll(), []);

  // Escape closes, unless a create is already in flight — the write cannot be called back, so the
  // dialog stays put and reports what happened rather than vanishing mid-request.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onCancel();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [submitting, onCancel]);

  return (
    <div className="p-modal" role="dialog" aria-modal="true" aria-labelledby="new-project-title">
      <div className="p-modal__dialog">
        <header className="p-modal__header">
          <h2 className="p-modal__title" id="new-project-title">
            New project
          </h2>
        </header>

        {/* The house identity block: what this is about, before what is being decided about it. */}
        <div className="remove-member-modal__body">
          <i className="p-icon--file p-icon--large" aria-hidden></i>
          <div>
            <p className="u-no-margin--bottom">
              <strong>{filename}</strong>
            </p>
            {/* Named as the *source* now that the name below it can differ. Without the word, a renamed
                project shows two names in one dialog with nothing to say which is which. */}
            <p className="u-text--muted p-text--small u-no-margin--bottom">
              Source file · {data.items.length}{" "}
              {data.items.length === 1 ? "question" : "questions"}
            </p>
          </div>
        </div>

        <div className="new-project__fields">
          {/* First, because it is the one field with a value already in it and the one a reader is most
              likely to want to correct before anything else. */}
          <label className={`new-project__field ${nameMissing ? "is-error" : ""}`}>
            <span className="u-text--muted p-text--small">Project name</span>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              disabled={submitting}
              aria-invalid={nameMissing}
              className="p-form-validation__input u-no-margin--bottom"
            />
            {nameMissing ? (
              <span className="p-form-validation__message">Give the project a name.</span>
            ) : (
              <span className="u-text--muted p-text--small">
                What this project is called in the app and what its CSV export is named after. The file
                itself is not renamed.
              </span>
            )}
          </label>

          <label className="new-project__field">
            <span className="u-text--muted p-text--small">Due date</span>
            {/* A plain date input rather than `DueDateField`: that control is click-to-edit at a fixed
                width with an overdue state, built for a card row. The UTC-midnight conversion is
                shared with it through `lib/dates.ts` instead, so the two cannot drift. */}
            <input
              type="date"
              value={dueDateInput}
              onChange={(e) => setDueDateInput(e.target.value)}
              disabled={submitting}
              className="u-no-margin--bottom"
            />
            <span className="u-text--muted p-text--small">
              Optional — a project can be scheduled later from the dashboard.
            </span>
          </label>

          <div className="new-project__field">
            <span className="u-text--muted p-text--small">Project team</span>
            <TeamMemberMultiSelect
              label=""
              value={ownerIds}
              teamMembers={teamMembers}
              onChange={setOwnerIds}
              emptyLabel="Assign"
              srName="Project team"
              disabled={submitting}
            />
            <span className="u-text--muted p-text--small">
              {myMemberId === null
                ? "You are not in the team bank yet, so you have not been added automatically."
                : "The project's owners. Only these people can be given its sections."}
            </span>
          </div>
        </div>

        {error && (
          <p className="file-loader__error p-text--small">
            <i className="p-icon--error" aria-hidden></i> {error}
          </p>
        )}

        <footer className="p-modal__footer">
          <button
            type="button"
            className={`u-no-margin--bottom ${cancelLabel ? "p-button--negative" : "p-button--base"}`}
            onClick={onCancel}
            disabled={submitting}
          >
            {cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            className="p-button--positive u-no-margin--bottom"
            onClick={() =>
              onSubmit({
                filename: trimmedName,
                dueDate: dateInputToIso(dueDateInput),
                ownerIds,
              })
            }
            disabled={submitting || nameMissing}
          >
            {submitting ? (
              <>
                <i className="p-icon--spinner u-animation--spin is-light" aria-hidden></i> Creating…
              </>
            ) : (
              "Create project"
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
