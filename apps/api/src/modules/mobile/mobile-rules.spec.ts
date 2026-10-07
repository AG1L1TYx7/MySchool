import {
  compactAssignment,
  dueBucket,
  isClientMessageId,
  mergeById,
  nextCursor,
  parseSince,
  sortForPhone,
  workState,
} from './mobile-rules';

describe('mobile rules', () => {
  const now = new Date('2026-10-06T15:00:00Z');

  it('buckets due dates for a phone', () => {
    expect(dueBucket(null, now)).toBe('none');
    expect(dueBucket(new Date('2026-10-05T23:59:00Z'), now)).toBe('overdue');
    expect(dueBucket(new Date('2026-10-06T09:00:00Z'), now)).toBe('overdue');
    expect(dueBucket(new Date('2026-10-06T20:00:00Z'), now)).toBe('today');
    expect(dueBucket(new Date('2026-10-07T08:00:00Z'), now)).toBe('tomorrow');
    expect(dueBucket(new Date('2026-10-10T08:00:00Z'), now)).toBe('this_week');
    expect(dueBucket(new Date('2026-10-20T08:00:00Z'), now)).toBe('later');
  });

  it('derives the state of a piece of work and compacts it', () => {
    const base = {
      id: 'a',
      title: 'Essay',
      classId: 'c',
      className: 'English',
      type: 'essay',
      maxPoints: 100,
      status: 'published',
    };
    expect(
      workState({ ...base, dueAt: new Date('2026-10-05T00:00:00Z') }, now),
    ).toBe('missing');
    expect(
      workState(
        {
          ...base,
          dueAt: new Date('2026-10-05T00:00:00Z'),
          mySubmission: { status: 'submitted' },
        },
        now,
      ),
    ).toBe('submitted');
    expect(
      workState({ ...base, dueAt: null, myGrade: { percentage: 91 } }, now),
    ).toBe('graded');
    expect(workState({ ...base, dueAt: null }, now)).toBe('open');
    const c = compactAssignment(
      {
        ...base,
        dueAt: new Date('2026-10-07T08:00:00Z'),
        myGrade: { percentage: 88 },
      },
      now,
    );
    expect(c).toMatchObject({
      state: 'graded',
      percentage: 88,
      bucket: 'tomorrow',
      dueAt: '2026-10-07T08:00:00.000Z',
    });
  });

  it('sorts overdue first and undated last', () => {
    const items = [
      { id: '1', dueAt: '2026-10-20T00:00:00Z', bucket: 'later' as const },
      { id: '2', dueAt: null, bucket: 'none' as const },
      { id: '3', dueAt: '2026-10-05T00:00:00Z', bucket: 'overdue' as const },
      { id: '4', dueAt: '2026-10-06T20:00:00Z', bucket: 'today' as const },
    ];
    expect(sortForPhone(items).map((i) => i.id)).toEqual(['3', '4', '1', '2']);
  });

  it('parses the sync cursor and merges records by id', () => {
    expect(parseSince(undefined, now)).toBeNull();
    expect(parseSince('nonsense', now)).toBeNull();
    expect(parseSince('2027-01-01T00:00:00Z', now)).toBeNull();
    expect(parseSince('2026-10-01T00:00:00Z', now)?.toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
    expect(nextCursor(now)).toBe('2026-10-06T14:59:58.000Z');
    const merged = mergeById(
      [
        { id: 'a', updatedAt: '2026-10-01T00:00:00Z', v: 'old' },
        { id: 'b', updatedAt: '2026-10-05T00:00:00Z', v: 'local' },
      ],
      [
        { id: 'a', updatedAt: '2026-10-02T00:00:00Z', v: 'new' },
        { id: 'c', updatedAt: '2026-10-03T00:00:00Z', v: 'server' },
      ],
    );
    expect(merged.map((m) => `${m.id}:${m.v}`).sort()).toEqual([
      'a:new',
      'b:local',
      'c:server',
    ]);
    expect(isClientMessageId('019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b')).toBe(
      true,
    );
    expect(isClientMessageId('nope')).toBe(false);
  });
});
