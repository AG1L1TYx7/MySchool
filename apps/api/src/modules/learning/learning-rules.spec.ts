import {
  buildStatement,
  cardsFromDialogcards,
  isMastered,
  isStruggling,
  isoDuration,
  learningCurve,
  masteryBand,
  masteryFrom,
  retentionRate,
  schedule,
  verbsForResult,
  weekStartOf,
} from './learning-rules';

describe('learning rules', () => {
  it('builds a valid xAPI statement with scaled score, duration and context', () => {
    const built = buildStatement({
      verb: 'passed',
      actor: { userId: 'u1', name: 'Emma' },
      object: { type: 'h5p-content', id: 'c1', name: 'Fractions quiz' },
      result: {
        raw: 8,
        max: 10,
        success: true,
        completion: true,
        durationSeconds: 3725,
      },
      context: { classId: 'k1', parentId: 'a1', registration: 'r1' },
      timestamp: new Date('2026-10-06T12:00:00Z'),
    });
    expect(built.resultScaled).toBe(0.8);
    expect(built.durationSeconds).toBe(3725);
    const s = built.statement as {
      verb: { id: string };
      result: { score: { scaled: number }; duration: string };
      context: {
        registration: string;
        contextActivities: { parent: unknown[]; grouping: unknown[] };
      };
      version: string;
    };
    expect(s.verb.id).toBe('http://adlnet.gov/expapi/verbs/passed');
    expect(s.result.score.scaled).toBe(0.8);
    expect(s.result.duration).toBe('PT1H2M5S');
    expect(s.context.registration).toBe('r1');
    expect(s.context.contextActivities.parent).toHaveLength(1);
    expect(s.version).toBe('1.0.3');
    expect(isoDuration(0)).toBe('PT0S');
    expect(isoDuration(61)).toBe('PT1M1S');
    expect(verbsForResult(7, 10, true)).toEqual(['completed', 'passed']);
    expect(verbsForResult(3, 10, true)).toEqual(['completed', 'failed']);
    expect(verbsForResult(0, 0, true)).toEqual(['completed']);
    expect(verbsForResult(5, 10, false)).toEqual(['attempted']);
  });

  it('schedules cards with SM-2: 1, 6, then growing; a lapse restarts', () => {
    const fresh = { easiness: 2.5, intervalDays: 0, repetitions: 0, lapses: 0 };
    const r1 = schedule(fresh, 4, '2026-10-06');
    expect(r1).toMatchObject({
      intervalDays: 1,
      repetitions: 1,
      dueOn: '2026-10-07',
      lapses: 0,
    });
    const r2 = schedule(r1, 5, '2026-10-07');
    expect(r2.intervalDays).toBe(6);
    expect(r2.easiness).toBeGreaterThan(2.5);
    const r3 = schedule(r2, 4, '2026-10-13');
    expect(r3.intervalDays).toBe(Math.round(6 * r3.easiness));
    expect(r3.repetitions).toBe(3);
    const lapse = schedule(r3, 1, '2026-10-20');
    expect(lapse).toMatchObject({ intervalDays: 1, repetitions: 0, lapses: 1 });
    expect(lapse.easiness).toBeLessThan(r3.easiness);
    let e = fresh;
    for (let i = 0; i < 20; i++) e = schedule(e, 0, '2026-10-06');
    expect(e.easiness).toBe(1.3);
    expect(
      isMastered({
        easiness: 2.6,
        intervalDays: 30,
        repetitions: 4,
        lapses: 0,
      }),
    ).toBe(true);
    expect(
      isMastered({
        easiness: 2.6,
        intervalDays: 30,
        repetitions: 2,
        lapses: 0,
      }),
    ).toBe(false);
    expect(
      isStruggling({
        easiness: 2.6,
        intervalDays: 1,
        repetitions: 0,
        lapses: 3,
      }),
    ).toBe(true);
    expect(
      isStruggling({
        easiness: 1.5,
        intervalDays: 1,
        repetitions: 0,
        lapses: 0,
      }),
    ).toBe(true);
    expect(retentionRate([5, 4, 2, 3])).toBe(75);
    expect(retentionRate([])).toBeNull();
  });

  it('reads cards out of a Dialogcards set and drops markup and empties', () => {
    expect(
      cardsFromDialogcards({
        dialogs: [
          {
            text: '<p>What is 2/4?</p>',
            answer: '<p>1/2</p>',
            tips: { front: 'simplify' },
          },
          { text: 'empty', answer: '' },
          { text: 'Denominator', answer: 'The bottom number' },
        ],
      }),
    ).toEqual([
      { front: 'What is 2/4?', back: '1/2', hint: 'simplify' },
      { front: 'Denominator', back: 'The bottom number', hint: null },
    ]);
    expect(cardsFromDialogcards({})).toEqual([]);
  });

  it('weights recent evidence more and reports a trend', () => {
    const now = new Date('2026-10-06T00:00:00Z');
    const day = (d: number) => new Date(now.getTime() - d * 86_400_000);
    const recentGood = masteryFrom(
      [
        { score: 0.4, at: day(60), weight: 1 },
        { score: 0.5, at: day(45), weight: 1 },
        { score: 0.9, at: day(2), weight: 1 },
        { score: 1, at: day(1), weight: 1 },
      ],
      now,
    );
    expect(recentGood.level).toBeGreaterThan(0.8);
    expect(recentGood.trend).toBe('up');
    const slipping = masteryFrom(
      [
        { score: 1, at: day(40), weight: 1 },
        { score: 0.9, at: day(30), weight: 1 },
        { score: 0.5, at: day(3), weight: 1 },
        { score: 0.4, at: day(1), weight: 1 },
      ],
      now,
    );
    expect(slipping.trend).toBe('down');
    expect(masteryFrom([], now)).toEqual({ level: null, trend: 'flat' });
    expect(masteryBand(0.95)).toBe('advanced');
    expect(masteryBand(0.7)).toBe('proficient');
    expect(masteryBand(0.5)).toBe('developing');
    expect(masteryBand(0.1)).toBe('beginning');
    expect(masteryBand(null)).toBeNull();
  });

  it('buckets the last weeks into a curve with empty weeks kept', () => {
    const now = new Date('2026-10-08T15:00:00Z'); // Thursday
    expect(weekStartOf(now)).toBe('2026-10-05');
    const curve = learningCurve(
      [
        { at: new Date('2026-10-06T10:00:00Z'), scaled: 0.8 },
        { at: new Date('2026-10-07T10:00:00Z'), scaled: 1 },
        { at: new Date('2026-09-23T10:00:00Z'), scaled: 0.5 },
        { at: new Date('2026-01-01T10:00:00Z'), scaled: 0.1 },
      ],
      [
        { at: new Date('2026-10-06T10:00:00Z'), quality: 4 },
        { at: new Date('2026-10-06T11:00:00Z'), quality: 2 },
      ],
      4,
      now,
    );
    expect(curve.map((p) => p.weekStart)).toEqual([
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
      '2026-10-05',
    ]);
    expect(curve[3]).toEqual({
      weekStart: '2026-10-05',
      items: 2,
      averageScaled: 0.9,
      retention: 50,
    });
    expect(curve[1]).toEqual({
      weekStart: '2026-09-21',
      items: 1,
      averageScaled: 0.5,
      retention: null,
    });
    expect(curve[2]).toEqual({
      weekStart: '2026-09-28',
      items: 0,
      averageScaled: null,
      retention: null,
    });
  });
});
