import {
  aiAllowed,
  behaviorVisibleToFamily,
  excerptFor,
  extendWindow,
  isUnder13,
} from './support-rules';

describe('support rules', () => {
  const now = new Date('2026-10-03T00:00:00Z');

  it('treats unknown and young birth dates as under 13', () => {
    expect(isUnder13(null, now)).toBe(true);
    expect(isUnder13(new Date('2015-01-01'), now)).toBe(true);
    expect(isUnder13(new Date('2012-09-01'), now)).toBe(false);
  });

  it('decides AI access from age, parent decision and school default', () => {
    expect(
      aiAllowed({
        dateOfBirth: new Date('2010-01-01'),
        schoolDefault: 'PARENT',
        consent: null,
        now,
      }),
    ).toEqual({ allowed: true, reason: 'adult' });
    expect(
      aiAllowed({
        dateOfBirth: new Date('2016-01-01'),
        schoolDefault: 'SCHOOL',
        consent: null,
        now,
      }),
    ).toEqual({ allowed: true, reason: 'school_default' });
    expect(
      aiAllowed({
        dateOfBirth: new Date('2016-01-01'),
        schoolDefault: 'SCHOOL',
        consent: 'DECLINED',
        now,
      }),
    ).toEqual({ allowed: false, reason: 'parent_declined' });
    expect(
      aiAllowed({
        dateOfBirth: new Date('2016-01-01'),
        schoolDefault: 'PARENT',
        consent: null,
        now,
      }),
    ).toEqual({ allowed: false, reason: 'parent_required' });
    expect(
      aiAllowed({
        dateOfBirth: new Date('2016-01-01'),
        schoolDefault: 'PARENT',
        consent: 'GRANTED',
        now,
      }),
    ).toEqual({ allowed: true, reason: 'parent_granted' });
  });

  it('applies the school visibility rule unless the record says otherwise', () => {
    expect(
      behaviorVisibleToFamily(
        { kind: 'POSITIVE', parentVisible: null },
        'POSITIVE_ONLY',
      ),
    ).toBe(true);
    expect(
      behaviorVisibleToFamily(
        { kind: 'INCIDENT', parentVisible: null },
        'POSITIVE_ONLY',
      ),
    ).toBe(false);
    expect(
      behaviorVisibleToFamily({ kind: 'INCIDENT', parentVisible: null }, 'ALL'),
    ).toBe(true);
    expect(
      behaviorVisibleToFamily(
        { kind: 'POSITIVE', parentVisible: null },
        'NONE',
      ),
    ).toBe(false);
    expect(
      behaviorVisibleToFamily(
        { kind: 'INCIDENT', parentVisible: true },
        'NONE',
      ),
    ).toBe(true);
    expect(
      behaviorVisibleToFamily(
        { kind: 'POSITIVE', parentVisible: false },
        'ALL',
      ),
    ).toBe(false);
  });

  it('stretches the assignment window by the extended time percent', () => {
    const opened = new Date('2026-10-01T00:00:00Z');
    const due = new Date('2026-10-03T00:00:00Z');
    const late = new Date('2026-10-04T00:00:00Z');
    const out = extendWindow(
      {
        availableFrom: opened,
        publishedAt: null,
        createdAt: opened,
        dueAt: due,
        allowLateUntil: late,
      },
      50,
    );
    expect(out.dueAt?.toISOString()).toBe('2026-10-04T00:00:00.000Z');
    expect(out.allowLateUntil?.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(out.extraMs).toBe(86_400_000);
    expect(
      extendWindow(
        {
          availableFrom: null,
          publishedAt: null,
          createdAt: opened,
          dueAt: null,
          allowLateUntil: null,
        },
        50,
      ).dueAt,
    ).toBeNull();
    expect(
      extendWindow(
        {
          availableFrom: opened,
          publishedAt: null,
          createdAt: opened,
          dueAt: due,
          allowLateUntil: null,
        },
        0,
      ).extraMs,
    ).toBe(0);
  });

  it('keeps a short excerpt', () => {
    expect(excerptFor('  hello   world  ')).toBe('hello world');
    expect(excerptFor('x'.repeat(500), 20)).toHaveLength(20);
  });
});
