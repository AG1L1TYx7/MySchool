import {
  appendTimeline,
  canExecuteDeletion,
  canMoveIncident,
  cutoffFor,
  DATA_MAP,
  exportManifest,
  incidentDeadlines,
  parseRetention,
  RETENTION_DEFAULTS,
  scheduleFor,
} from './compliance-rules';

describe('compliance rules', () => {
  it('fills retention defaults and clamps stored values to safe bounds', () => {
    expect(parseRetention(null)).toEqual(RETENTION_DEFAULTS);
    expect(parseRetention('not json')).toEqual(RETENTION_DEFAULTS);
    const p = parseRetention(
      '{"aiConversations":5,"auditLogs":99999,"notifications":"soon","withdrawnStudents":0,"pushLogs":30}',
    );
    expect(p.aiConversations).toBe(30);
    expect(p.auditLogs).toBe(3650);
    expect(p.notifications).toBe(180);
    expect(p.withdrawnStudents).toBe(0);
    expect(p.pushLogs).toBe(30);
  });

  it('turns days into a cutoff, keeping forever at zero', () => {
    const now = new Date('2026-10-07T00:00:00Z');
    expect(cutoffFor(0, now)).toBeNull();
    expect(cutoffFor(30, now)?.toISOString()).toBe('2026-09-07T00:00:00.000Z');
  });

  it('schedules erasure after the grace period and never under a legal hold', () => {
    const approved = new Date('2026-10-07T12:00:00Z');
    const when = scheduleFor(approved);
    expect(when.toISOString()).toBe('2026-11-06T12:00:00.000Z');
    expect(
      canExecuteDeletion(
        { status: 'approved', scheduledFor: when, legalHold: false },
        new Date('2026-11-05T00:00:00Z'),
      ),
    ).toBe(false);
    expect(
      canExecuteDeletion(
        { status: 'approved', scheduledFor: when, legalHold: false },
        new Date('2026-11-07T00:00:00Z'),
      ),
    ).toBe(true);
    expect(
      canExecuteDeletion(
        { status: 'approved', scheduledFor: when, legalHold: true },
        new Date('2026-11-07T00:00:00Z'),
      ),
    ).toBe(false);
    expect(
      canExecuteDeletion(
        { status: 'pending', scheduledFor: when, legalHold: false },
        new Date('2026-11-07T00:00:00Z'),
      ),
    ).toBe(false);
  });

  it('sets the breach clock by severity and keeps the timeline bounded', () => {
    const detected = new Date('2026-10-07T09:00:00Z');
    expect(incidentDeadlines(detected, 'low').districtBy.toISOString()).toBe(
      '2026-10-10T09:00:00.000Z',
    );
    expect(
      incidentDeadlines(detected, 'critical').districtBy.toISOString(),
    ).toBe('2026-10-08T09:00:00.000Z');
    expect(incidentDeadlines(detected, 'critical').notifyBy.toISOString()).toBe(
      '2026-10-10T09:00:00.000Z',
    );
    const t = appendTimeline('bad', {
      at: '2026-10-07T09:00:00Z',
      by: 'u',
      note: 'Detected',
    });
    expect(JSON.parse(t)).toHaveLength(1);
    expect(canMoveIncident('open', 'contained')).toBe(true);
    expect(canMoveIncident('notified', 'open')).toBe(false);
    expect(canMoveIncident('open', 'closed')).toBe(true);
  });

  it('describes every personal-data table once and lists export sections in order', () => {
    const tables = DATA_MAP.map((d) => d.table);
    expect(new Set(tables).size).toBe(tables.length);
    expect(
      DATA_MAP.some(
        (d) => d.table === 'CounselorNotes' && /sole-possession/.test(d.basis),
      ),
    ).toBe(true);
    const m = exportManifest({
      studentNumber: 'S1',
      generatedAt: new Date('2026-10-07T00:00:00Z'),
      counts: { grades: 3 },
      requestedBy: 'parent',
    });
    expect((m.sections as Array<{ name: string; rows: number }>)[0].name).toBe(
      'profile',
    );
    expect(
      (m.sections as Array<{ name: string; rows: number }>).find(
        (s) => s.name === 'grades',
      )?.rows,
    ).toBe(3);
  });
});
