import type { TeamMember } from "@/lib/types";

interface Props {
  member: TeamMember;
  size?: "small" | "large";
}

export default function TeamMemberAvatar({ member, size }: Props) {
  const sizeClass = size ? `team-member-avatar--${size}` : "";
  return member.photoURL ? (
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
