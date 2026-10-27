"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import RemoveUserDialog from "./RemoveUserDialog";
import RemoveProjectDialog from "./RemoveProjectDialog";
import { subscribeToSavedFiles } from "@/lib/savedFiles";
import { addTeamMember } from "@/lib/teamBank";
import { grantAdmin, revokeAdmin, type AdminGrant } from "@/lib/admins";
import { formatTimestamp } from "@/lib/utils";
import type { SavedFileMeta, TeamMember } from "@/lib/types";

interface Props {
  teamMembers: TeamMember[];
  admins: Record<string, AdminGrant>;
  me: TeamMember | null;
  onError: (title: string, message: string) => void;
  onDocRemoved: (docId: string) => void;
  onExported: () => void;
}

/**
 * What admin power covers, as the Admin tab's permissions table shows it. Descriptive, not a
 * configuration: each "admin only" row is a control gated on `isAdmin` and a rule in
 * `database.rules.json`. Change one without the others and this table is lying.
 */
const PERMISSIONS: ReadonlyArray<{ action: string; everyone: boolean }> = [
  { action: "Create, open and export projects", everyone: true },
  { action: "Answer, edit, rate and approve (as section reviewer)", everyone: true },
  { action: "Assign project owners and sections", everyone: true },
  { action: "Report deal outcomes on completed projects", everyone: true },
  { action: "Remove projects, including Export and remove", everyone: false },
  { action: "Add people to the tool", everyone: false },
  { action: "Remove people from the tool", everyone: false },
  { action: "Grant and revoke admin power", everyone: false },
];

const CANONICAL_EMAIL = /^[^\s@]+@canonical\.com$/i;

/** `alice.smith@canonical.com` → `Alice Smith`, for an added user whose name was left blank. */
function nameFromEmail(email: string): string {
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function Avatar({ member }: { member: TeamMember }) {
  return member.photoURL ? (
    // Remote avatar, static export — see TeamMemberAvatar.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={member.photoURL} alt="" referrerPolicy="no-referrer" className="team-member-avatar admin-user__avatar" />
  ) : (
    <span className="team-member-avatar team-member-avatar--placeholder admin-user__avatar">
      <i className="p-icon--user"></i>
    </span>
  );
}

/**
 * The Admin tab: user management, admin grants and project removal, in one place.
 *
 * Admins only: `AppShell` renders this only while `isAdmin`, and the sidebar offers the tab to nobody
 * else, so nothing here is gated on admin power. What is gated is admins acting on themselves — see
 * `grantBlockedReason` and `removeBlockedReason`. The rules enforce the admin split as well (see
 * `lib/admins.ts`).
 *
 * Projects take the wider column — they are what this tab is mostly for; users and the permissions
 * table share the narrower one.
 */
export default function AdminView({
  teamMembers,
  admins,
  me,
  onError,
  onDocRemoved,
  onExported,
}: Props) {
  const [savedFiles, setSavedFiles] = useState<SavedFileMeta[]>([]);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  // The add-user dialog. Its fields live in a modal rather than under the search, where two more text
  // boxes read as two more searches.
  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addNotice, setAddNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null);
  const [fileToRemove, setFileToRemove] = useState<SavedFileMeta | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  // Members whose admin grant is being written, so their button can refuse a second click.
  const [pendingGrantIds, setPendingGrantIds] = useState<string[]>([]);

  // The same live metadata listener the Projects dropdown holds — records only, never documents.
  useEffect(() => subscribeToSavedFiles(setSavedFiles), []);

  const adminCount = Object.keys(admins).length;

  // Admins first, then by name — the bank already arrives sorted by name.
  const visibleMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return teamMembers
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
      .sort((a, b) => Number(Boolean(admins[b.id])) - Number(Boolean(admins[a.id])));
  }, [teamMembers, admins, query]);

  const neverExported = savedFiles.filter((f) => f.exportedAt === null).length;

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const email = newEmail.trim();
    if (!CANONICAL_EMAIL.test(email)) {
      setAddNotice({ ok: false, text: "Enter a @canonical.com address — nobody else can sign in." });
      return;
    }
    const name = newName.trim() || nameFromEmail(email);
    setAdding(true);
    setAddNotice(null);
    try {
      const result = await addTeamMember(name, email);
      if (result.ok) {
        setAddNotice({ ok: true, text: `${name} added. They can be given projects and sections now.` });
        setNewName("");
        setNewEmail("");
        setAddOpen(false);
      } else {
        setAddNotice({ ok: false, text: `${email} is already in the tool.` });
      }
    } catch {
      setAddNotice({ ok: false, text: "That could not be saved. Only admins can add people." });
    } finally {
      setAdding(false);
    }
  }

  function openAdd() {
    setAddNotice(null);
    setAddOpen(true);
  }

  function closeAdd() {
    setAddOpen(false);
    setAddNotice(null);
    setNewName("");
    setNewEmail("");
  }

  async function toggleAdmin(member: TeamMember) {
    if (!me) return;
    const holding = Boolean(admins[member.id]);
    setPendingGrantIds((ids) => [...ids, member.id]);
    try {
      if (holding) await revokeAdmin(member.id);
      else await grantAdmin(member.id, { name: me.name, email: me.email });
    } catch {
      onError(
        holding ? `Admin power not revoked from ${member.name}` : `${member.name} was not made an admin`,
        "The change was refused or did not reach the server."
      );
    } finally {
      setPendingGrantIds((ids) => ids.filter((id) => id !== member.id));
    }
  }

  /** Why this row's admin toggle is off, or undefined when it can be used. */
  function grantBlockedReason(member: TeamMember): string | undefined {
    if (member.id === me?.id && adminCount <= 1) {
      return "You are the only admin. Make someone else an admin before giving it up.";
    }
    return undefined;
  }

  function removeBlockedReason(member: TeamMember): string | undefined {
    if (member.id === me?.id) return "You cannot remove yourself. Another admin can.";
    return undefined;
  }

  return (
    <main className="app-main admin">
      <div className="admin__head">
        <h2 className="p-heading--4 u-no-margin--bottom">Admin</h2>
      </div>

      <div className="summary-strip">
        <div className="summary-strip__tile">
          <span className="summary-strip__value">{teamMembers.length}</span>
          <span className="summary-strip__label">People in the tool</span>
        </div>
        <div className="summary-strip__tile summary-strip__tile--positive">
          <span className="summary-strip__value">{adminCount}</span>
          <span className="summary-strip__label">Admins</span>
        </div>
        <div className="summary-strip__tile">
          <span className="summary-strip__value">{savedFiles.length}</span>
          <span className="summary-strip__label">Active projects</span>
        </div>
        <div
          className={`summary-strip__tile${neverExported > 0 ? " summary-strip__tile--caution" : ""}`}
        >
          <span className="summary-strip__value">{neverExported}</span>
          <span className="summary-strip__label">Never exported</span>
        </div>
      </div>

      <div className="admin__grid">
        {/* ── Projects ── */}
        <section
          className="p-card admin__panel admin__panel--projects"
          aria-labelledby="admin-projects-title"
        >
          <div className="admin__panel-head">
            <h3 className="p-heading--5 admin__panel-title" id="admin-projects-title">
              Projects
              <span className="u-text--muted p-text--small completed-list__count">
                {savedFiles.length}
              </span>
            </h3>
          </div>
          {projectError && (
            <p className="p-text--small admin__notice admin__notice--error" role="alert">
              {projectError}
            </p>
          )}
          {/* Fills the card's height rather than setting it — see `.admin__panel-body`. */}
          <div className="admin__panel-body">
            {savedFiles.length > 0 ? (
              <ul className="admin__list">
                {savedFiles.map((f) => (
                  <li key={f.id} className="admin-project">
                    <i className="p-icon--file" aria-hidden></i>
                    <span className="admin-user__who">
                      <span className="admin-user__name" title={f.filename}>
                        {f.filename}
                      </span>
                      <span className="admin-user__email u-text--muted">
                        {f.uploadedByName} · {formatTimestamp(f.uploadedAt)}
                      </span>
                    </span>
                    <i
                      className={f.exportedAt !== null ? "p-icon--success" : "p-icon--warning"}
                      title={
                        f.exportedAt !== null
                          ? `Exported ${formatTimestamp(f.exportedAt)}`
                          : "Never exported"
                      }
                      aria-label={f.exportedAt !== null ? "Exported" : "Never exported"}
                    ></i>
                    <button
                      type="button"
                      className="p-button--negative is-dense u-no-margin--bottom"
                      onClick={() => {
                        setProjectError(null);
                        setFileToRemove(f);
                      }}
                      aria-label={`Remove ${f.filename}`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="u-text--muted p-text--small u-no-margin--bottom">No projects yet.</p>
            )}
          </div>
        </section>

        <div className="admin__side">
          {/* ── Users ── */}
          <section className="p-card admin__panel" aria-labelledby="admin-users-title">
            <div className="admin__panel-head">
              <h3 className="p-heading--5 admin__panel-title" id="admin-users-title">
                Users
                {/* How many the list is showing — all of them, or the search's matches. */}
                <span className="u-text--muted p-text--small completed-list__count">
                  {visibleMembers.length}
                </span>
              </h3>
              {/* Full size rather than `is-dense`, to match the search box beside it: Vanilla's search box
                  has no dense variant. */}
              <button
                type="button"
                className="p-button--positive u-no-margin--bottom"
                onClick={openAdd}
              >
                <i className="p-icon--plus is-light" aria-hidden></i> Add user
              </button>
              {/* Vanilla's search box, so the clear control is Vanilla's reset rather than the browser's
                  own X — which only some browsers draw, each its own way. A `div`, not the pattern's
                  usual `form`: the search filters as you type, there is nothing to submit, and outside
                  a form `required` (what lets Vanilla hide the reset while the box is empty, through
                  `:not(:valid)`) can never raise a validation pop-up. */}
              <div className="p-search-box u-no-margin--bottom admin__search">
                <label className="u-off-screen" htmlFor="admin-user-search">
                  Search users
                </label>
                <input
                  ref={searchRef}
                  id="admin-user-search"
                  type="search"
                  className="p-search-box__input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name or email"
                  required
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="p-search-box__reset"
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                >
                  <i className="p-icon--close">Clear search</i>
                </button>
                <button
                  type="button"
                  className="p-search-box__button"
                  onClick={() => searchRef.current?.focus()}
                >
                  <i className="p-icon--search">Search</i>
                </button>
              </div>
            </div>

            {/* Success only — a refusal is reported inside the dialog, which stays open for a retry. */}
            {addNotice?.ok && (
              <p className="p-text--small admin__notice" role="status">
                {addNotice.text}
              </p>
            )}

            {/* Sized from the whole bank, not from the matches (`--admin-user-rows`), so the panel keeps
                one height while a search narrows the list — and Projects, which matches this column's
                height, does not jump about as someone types. */}
            <ul
              className="admin__list admin__list--users"
              style={{ "--admin-user-rows": Math.max(teamMembers.length, 1) } as CSSProperties}
            >
              {visibleMembers.length === 0 && (
                <li className="admin__list-empty u-text--muted p-text--small">
                  {teamMembers.length === 0 ? "No users yet." : "Nobody matches that search."}
                </li>
              )}
                {visibleMembers.map((m) => {
                  const grant = admins[m.id];
                  const grantBlocked = grantBlockedReason(m);
                  const removeBlocked = removeBlockedReason(m);
                  const pending = pendingGrantIds.includes(m.id);
                  return (
                    <li key={m.id} className="admin-user">
                      <Avatar member={m} />
                      <span className="admin-user__who">
                        {/* The role sits on the name line rather than in a column of its own: this
                            panel is the narrow one, and a role track would leave the name no room.
                            No badge means a member. */}
                        <span className="admin-user__name-line">
                          <span className="admin-user__name">
                            {m.name}
                            {m.id === me?.id && <span className="u-text--muted"> (you)</span>}
                          </span>
                          {grant && (
                            <span
                              className="section-header__block admin-user__badge"
                              title={`Admin since ${formatTimestamp(grant.grantedAt)}, granted by ${grant.grantedBy}`}
                            >
                              Admin
                            </span>
                          )}
                        </span>
                        <span className="admin-user__email u-text--muted">{m.email}</span>
                      </span>
                      <span className="admin-user__actions">
                        <button
                          type="button"
                          className="p-button--base is-dense u-no-margin--bottom"
                          onClick={() => toggleAdmin(m)}
                          disabled={grantBlocked !== undefined || pending}
                          title={grantBlocked}
                        >
                          {grant ? "Revoke admin" : "Make admin"}
                        </button>
                        <button
                          type="button"
                          className="p-button--negative is-dense u-no-margin--bottom"
                          onClick={() => setMemberToRemove(m)}
                          disabled={removeBlocked !== undefined}
                          title={removeBlocked}
                          aria-label={`Remove ${m.name} from the tool`}
                        >
                          Remove
                        </button>
                      </span>
                    </li>
                  );
                })}
            </ul>
          </section>

          {/* ── Roles & permissions ── */}
          <section className="p-card admin__panel" aria-labelledby="admin-roles-title">
            <div className="admin__panel-head">
              <h3 className="p-heading--5 admin__panel-title" id="admin-roles-title">
                Roles &amp; permissions
              </h3>
            </div>
            <table className="admin__permissions u-no-margin--bottom">
              <thead>
                <tr>
                  <th>Action</th>
                  <th className="admin__permissions-col">Member</th>
                  <th className="admin__permissions-col">Admin</th>
                </tr>
              </thead>
              <tbody>
                {PERMISSIONS.map((p) => (
                  <tr key={p.action}>
                    <td>{p.action}</td>
                    <td className="admin__permissions-col">
                      {p.everyone ? (
                        <i className="p-icon--success">Allowed</i>
                      ) : (
                        <i className="p-icon--lock-locked">Admin only</i>
                      )}
                    </td>
                    <td className="admin__permissions-col">
                      <i className="p-icon--success">Allowed</i>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>

      {addOpen && (
        <div className="p-modal" role="dialog" aria-modal="true" aria-labelledby="add-user-title">
          <form className="p-modal__dialog" onSubmit={handleAdd}>
            <header className="p-modal__header">
              <h2 className="p-modal__title" id="add-user-title">Add user</h2>
            </header>
            <p className="p-text--small u-text--muted">
              They can be made a project owner or given sections straight away, before they first sign
              in. Their photo appears once they do.
            </p>
            <label htmlFor="add-user-email">Email</label>
            <input
              id="add-user-email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="name@canonical.com"
              disabled={adding}
              autoFocus
            />
            <label htmlFor="add-user-name">Name (optional)</label>
            <input
              id="add-user-name"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={newEmail.includes("@") ? nameFromEmail(newEmail) : "Taken from the email if blank"}
              disabled={adding}
            />
            {addNotice && !addNotice.ok && (
              <p className="p-text--small admin__notice admin__notice--error" role="alert">
                {addNotice.text}
              </p>
            )}
            <footer className="p-modal__footer">
              <button type="button" className="p-button--base u-no-margin--bottom" onClick={closeAdd} disabled={adding}>
                Cancel
              </button>
              <button
                type="submit"
                className="p-button--positive u-no-margin--bottom"
                disabled={adding || newEmail.trim() === ""}
              >
                {adding ? "Adding…" : "Add user"}
              </button>
            </footer>
          </form>
        </div>
      )}
      {memberToRemove && (
        <RemoveUserDialog
          member={memberToRemove}
          onClose={() => setMemberToRemove(null)}
          onError={onError}
        />
      )}
      {fileToRemove && (
        <RemoveProjectDialog
          file={fileToRemove}
          onClose={() => setFileToRemove(null)}
          onDocRemoved={onDocRemoved}
          onExported={onExported}
          onError={setProjectError}
        />
      )}
    </main>
  );
}
