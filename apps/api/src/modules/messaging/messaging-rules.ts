import type { Role } from '../../generated/prisma/client';

/**
 * Who may message whom (docs/11: children's safety first).
 * Staff reach everyone in their school. Students reach staff only; classmates meet in class
 * conversations a teacher opens. Parents reach staff. Nobody reaches outside their organisation.
 */
const STAFF: readonly Role[] = [
  'TEACHER',
  'ASSISTANT',
  'PRINCIPAL',
  'SUPERINTENDENT',
  'SUPER_ADMIN',
];

export function isStaffRole(role: Role): boolean {
  return STAFF.includes(role);
}

export function canDirectMessage(actor: Role, target: Role): boolean {
  if (isStaffRole(actor)) return true;
  return isStaffRole(target);
}

export function canCreateGroup(actor: Role): boolean {
  return isStaffRole(actor);
}

/** Learners pick a title from the other participants; staff groups keep their own title. */
export function displayTitle(input: {
  type: 'DIRECT' | 'GROUP' | 'CLASS';
  title: string | null;
  viewerId: string;
  participants: Array<{ id: string; firstName: string; lastName: string }>;
}): string {
  if (input.title && input.type !== 'DIRECT') return input.title;
  const others = input.participants.filter((p) => p.id !== input.viewerId);
  if (others.length === 0) return input.title ?? 'Just you';
  const names = others
    .slice(0, 3)
    .map((p) => `${p.firstName} ${p.lastName}`.trim());
  return others.length > 3
    ? `${names.join(', ')} and ${others.length - 3} more`
    : names.join(', ');
}

/** Unread = messages from others after my last read mark. */
export function unreadCount(
  messages: Array<{
    senderId: string | null;
    createdAt: Date;
    deletedAt: Date | null;
  }>,
  viewerId: string,
  lastReadAt: Date | null,
): number {
  return messages.filter(
    (m) =>
      m.senderId !== viewerId &&
      !m.deletedAt &&
      (!lastReadAt || m.createdAt > lastReadAt),
  ).length;
}

export const MAX_MESSAGE_LENGTH = 4000;
export const EDIT_WINDOW_MINUTES = 60;

export function canEditMessage(
  message: { senderId: string | null; createdAt: Date; deletedAt: Date | null },
  viewerId: string,
  now = new Date(),
): boolean {
  if (message.deletedAt || message.senderId !== viewerId) return false;
  return (
    now.getTime() - message.createdAt.getTime() <= EDIT_WINDOW_MINUTES * 60_000
  );
}

export function canDeleteMessage(
  message: { senderId: string | null; deletedAt: Date | null },
  viewer: { id: string; canModerate: boolean },
): boolean {
  if (message.deletedAt) return false;
  return message.senderId === viewer.id || viewer.canModerate;
}
