import {
  canEdit,
  compareForFeed,
  isExpired,
  isVisibleTo,
  type AnnouncementLike,
  type Viewer,
} from './announcement-rules';

const base: AnnouncementLike = {
  status: 'PUBLISHED',
  classId: null,
  authorId: 't1',
  expiresAt: null,
  publishedAt: new Date('2026-10-01'),
  pinned: false,
  priority: 'NORMAL',
};
const student: Viewer = {
  id: 's1',
  isStaff: false,
  isAdmin: false,
  classIds: ['c1'],
};
const teacher: Viewer = {
  id: 't1',
  isStaff: true,
  isAdmin: false,
  classIds: ['c1'],
};
const other: Viewer = { id: 't2', isStaff: true, isAdmin: false, classIds: [] };
const admin: Viewer = { id: 'p1', isStaff: true, isAdmin: true, classIds: [] };

describe('announcement rules', () => {
  it('shows published items to the school or the class, hides expired ones from learners', () => {
    expect(isVisibleTo(base, student)).toBe(true);
    expect(isVisibleTo({ ...base, classId: 'c1' }, student)).toBe(true);
    expect(isVisibleTo({ ...base, classId: 'c2' }, student)).toBe(false);
    expect(isVisibleTo({ ...base, classId: 'c2' }, admin)).toBe(true);
    const expired = { ...base, expiresAt: new Date('2026-09-01') };
    expect(isVisibleTo(expired, student, new Date('2026-10-01'))).toBe(false);
    expect(isVisibleTo(expired, teacher, new Date('2026-10-01'))).toBe(true);
    expect(isExpired(expired, new Date('2026-10-01'))).toBe(true);
  });

  it('keeps drafts with their author and administrators', () => {
    const draft = { ...base, status: 'DRAFT' as const };
    expect(isVisibleTo(draft, student)).toBe(false);
    expect(isVisibleTo(draft, teacher)).toBe(true);
    expect(isVisibleTo(draft, other)).toBe(false);
    expect(isVisibleTo(draft, admin)).toBe(true);
    expect(canEdit(base, teacher)).toBe(true);
    expect(canEdit(base, other)).toBe(false);
    expect(canEdit(base, admin)).toBe(true);
    expect(canEdit(base, student)).toBe(false);
  });

  it('orders the feed by pin, urgency, then recency', () => {
    const rows: AnnouncementLike[] = [
      { ...base, publishedAt: new Date('2026-10-03') },
      { ...base, priority: 'URGENT', publishedAt: new Date('2026-09-01') },
      {
        ...base,
        pinned: true,
        priority: 'LOW',
        publishedAt: new Date('2026-08-01'),
      },
      { ...base, publishedAt: new Date('2026-10-02') },
    ];
    const sorted = [...rows].sort(compareForFeed);
    expect(
      sorted.map(
        (r) =>
          `${r.pinned ? 'pin' : ''}${r.priority}${r.publishedAt?.toISOString().slice(5, 10)}`,
      ),
    ).toEqual(['pinLOW08-01', 'URGENT09-01', 'NORMAL10-03', 'NORMAL10-02']);
  });
});
