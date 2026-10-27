"use client";

import { useState } from "react";
import { removeUserFromTool } from "@/lib/admins";
import type { TeamMember } from "@/lib/types";

interface Props {
  member: TeamMember;
  onClose: () => void;
  onError: (title: string, message: string) => void;
}

/**
 * Confirm taking somebody out of the tool. Shared by the dashboard's Manage Users panel and the Admin
 * tab, so the two say the same thing and run the same `removeUserFromTool`.
 *
 * The dialog closes once the write lands rather than on click, so a refusal — the rules turn down a
 * non-admin, and a stale tab can still hold an admin's view — is reported against the dialog that
 * caused it.
 */
export default function RemoveUserDialog({ member, onClose, onError }: Props) {
  const [removing, setRemoving] = useState(false);

  async function confirm() {
    setRemoving(true);
    try {
      await removeUserFromTool(member.id);
      onClose();
    } catch {
      onClose();
      onError(
        `${member.name} was not removed`,
        "The change was refused or did not reach the server. Only admins can remove people from the tool."
      );
    }
  }

  return (
    <div className="p-modal" role="dialog" aria-modal="true" aria-labelledby="remove-member-title">
      <div className="p-modal__dialog">
        <header className="p-modal__header">
          <h2 className="p-modal__title" id="remove-member-title">Remove from the tool?</h2>
        </header>
        <div className="remove-member-modal__body">
          {member.photoURL ? (
            // Remote avatar, static export — see TeamMemberAvatar.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={member.photoURL}
              alt=""
              referrerPolicy="no-referrer"
              className="team-member-avatar team-member-avatar--large"
            />
          ) : (
            <span className="team-member-avatar team-member-avatar--large team-member-avatar--placeholder">
              <i className="p-icon--user"></i>
            </span>
          )}
          <div>
            <p className="u-no-margin--bottom"><strong>{member.name}</strong></p>
            <p className="u-text--muted p-text--small u-no-margin--bottom">{member.email}</p>
          </div>
        </div>
        <p className="p-text--small">
          They come off every project they own, every section they answer or review goes back to
          Unassigned, and any admin power they hold is revoked. Their past approvals stay.
        </p>
        <footer className="p-modal__footer">
          <button className="p-button--base u-no-margin--bottom" onClick={onClose} disabled={removing}>
            Cancel
          </button>
          <button className="p-button--negative u-no-margin--bottom" onClick={confirm} disabled={removing}>
            {removing ? "Removing…" : "Remove"}
          </button>
        </footer>
      </div>
    </div>
  );
}
