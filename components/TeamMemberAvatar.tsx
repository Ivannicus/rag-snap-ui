import type { TeamMember } from "@/lib/types";

interface Props {
  member: TeamMember;
  size?: "small" | "large";
}

export default function TeamMemberAvatar({ member, size }: Props) {
  const sizeClass = size ? `team-member-avatar--${size}` : "";
  return member.photoURL ? (
    // A plain <img>, not next/image: this app builds with `output: 'export'`, which has no image
    // optimizer to route through, and the src is a Google profile URL rather than a bundled asset.
    // eslint-disable-next-line @next/next/no-img-element -- remote avatar, static export
    <img
      src={member.photoURL}
      alt=""
      referrerPolicy="no-referrer"
      className={`team-member-avatar ${sizeClass}`.trim()}
    />
  ) : (
    <span className={`team-member-avatar team-member-avatar--placeholder ${sizeClass}`.trim()}>
      <i className="p-icon--user"></i>
    </span>
  );
}
