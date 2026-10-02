import {
  canCreateGroup,
  canDeleteMessage,
  canDirectMessage,
  canEditMessage,
  displayTitle,
  unreadCount,
} from './messaging-rules';

describe('messaging rules', () => {
  it('lets staff reach everyone and learners reach staff only', () => {
    expect(canDirectMessage('TEACHER', 'STUDENT')).toBe(true);
    expect(canDirectMessage('TEACHER', 'PARENT')).toBe(true);
    expect(canDirectMessage('STUDENT', 'TEACHER')).toBe(true);
    expect(canDirectMessage('STUDENT', 'STUDENT')).toBe(false);
    expect(canDirectMessage('STUDENT', 'PARENT')).toBe(false);
    expect(canDirectMessage('PARENT', 'STUDENT')).toBe(false);
    expect(canDirectMessage('PARENT', 'PRINCIPAL')).toBe(true);
    expect(canCreateGroup('STUDENT')).toBe(false);
    expect(canCreateGroup('TEACHER')).toBe(true);
  });

  it('titles direct chats by the other person and groups by their title', () => {
    const people = [
      { id: 'me', firstName: 'Emma', lastName: 'Johnson' },
      { id: 't', firstName: 'Sarah', lastName: 'Smith' },
    ];
    expect(
      displayTitle({
        type: 'DIRECT',
        title: null,
        viewerId: 'me',
        participants: people,
      }),
    ).toBe('Sarah Smith');
    expect(
      displayTitle({
        type: 'GROUP',
        title: 'Field trip',
        viewerId: 'me',
        participants: people,
      }),
    ).toBe('Field trip');
    const many = [
      ...people,
      { id: 'a', firstName: 'A', lastName: 'B' },
      { id: 'c', firstName: 'C', lastName: 'D' },
      { id: 'e', firstName: 'E', lastName: 'F' },
    ];
    expect(
      displayTitle({
        type: 'GROUP',
        title: null,
        viewerId: 'me',
        participants: many,
      }),
    ).toBe('Sarah Smith, A B, C D and 1 more');
  });

  it('counts unread from others after the read mark, and bounds editing and deleting', () => {
    const t = (s: string) => new Date(s);
    const msgs = [
      { senderId: 'me', createdAt: t('2026-10-01T10:00:00Z'), deletedAt: null },
      { senderId: 'x', createdAt: t('2026-10-01T10:01:00Z'), deletedAt: null },
      {
        senderId: 'x',
        createdAt: t('2026-10-01T10:02:00Z'),
        deletedAt: t('2026-10-01T10:03:00Z'),
      },
      { senderId: 'x', createdAt: t('2026-10-01T09:00:00Z'), deletedAt: null },
    ];
    expect(unreadCount(msgs, 'me', t('2026-10-01T09:30:00Z'))).toBe(1);
    expect(unreadCount(msgs, 'me', null)).toBe(2);
    const mine = {
      senderId: 'me',
      createdAt: t('2026-10-01T10:00:00Z'),
      deletedAt: null,
    };
    expect(canEditMessage(mine, 'me', t('2026-10-01T10:30:00Z'))).toBe(true);
    expect(canEditMessage(mine, 'me', t('2026-10-01T11:30:00Z'))).toBe(false);
    expect(canEditMessage(mine, 'x', t('2026-10-01T10:30:00Z'))).toBe(false);
    expect(canDeleteMessage(mine, { id: 'x', canModerate: false })).toBe(false);
    expect(canDeleteMessage(mine, { id: 'x', canModerate: true })).toBe(true);
    expect(
      canDeleteMessage(
        { ...mine, deletedAt: t('2026-10-01T10:05:00Z') },
        { id: 'me', canModerate: true },
      ),
    ).toBe(false);
  });
});
