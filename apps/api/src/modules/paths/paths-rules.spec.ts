import {
  buildPathSteps,
  learningHealth,
  masteryGaps,
  pathProgress,
  pathTitle,
  recommend,
  stepsFinishedBy,
  type MasteryRow,
} from './paths-rules';

const rows: MasteryRow[] = [
  {
    standardId: 'a',
    code: '5.NF.1',
    description: 'Add fractions with unlike denominators',
    level: 0.3,
    trend: 'down',
    evidenceCount: 4,
  },
  {
    standardId: 'b',
    code: '5.NF.2',
    description: 'Solve word problems with fractions',
    level: 0.55,
    trend: 'flat',
    evidenceCount: 2,
  },
  {
    standardId: 'c',
    code: '5.NBT.1',
    description: 'Place value',
    level: 0.9,
    trend: 'up',
    evidenceCount: 6,
  },
  {
    standardId: 'd',
    code: '5.MD.1',
    description: 'Convert units',
    level: 0.1,
    trend: 'flat',
    evidenceCount: 0,
  },
];
const contentFor = (id: string) =>
  id === 'a'
    ? [
        {
          kind: 'lesson' as const,
          id: 'l1',
          title: 'Fractions lesson',
          href: '/courses/lessons/l1',
        },
        {
          kind: 'library' as const,
          id: 'lib1',
          title: 'Fractions quiz',
          href: '/library/lib1',
        },
      ]
    : [];

describe('learning health', () => {
  it('scores five parts with weights and explains each one', () => {
    const h = learningHealth({
      mastery: 0.8,
      attendanceRate: 95,
      missing: 0,
      practiceDue: 0,
      practiceReviews30: 20,
      lessonsCompleted8w: 6,
      failingClasses: 0,
    });
    expect(h.parts.map((p) => p.key)).toEqual([
      'mastery',
      'attendance',
      'work',
      'practice',
      'engagement',
    ]);
    expect(h.parts.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1);
    expect(h.score).toBeGreaterThanOrEqual(85);
    expect(h.band).toBe('thriving');
    expect(h.parts[2].note).toContain('Nothing missing');
  });

  it('stays neutral without evidence and drops with missing work and failing classes', () => {
    const empty = learningHealth({
      mastery: null,
      attendanceRate: null,
      missing: 0,
      practiceDue: 0,
      practiceReviews30: 0,
      lessonsCompleted8w: 0,
      failingClasses: 0,
    });
    expect(empty.band).toBe('steady');
    expect(empty.parts[0].note).toContain('No standards');
    const low = learningHealth({
      mastery: 0.3,
      attendanceRate: 70,
      missing: 4,
      practiceDue: 12,
      practiceReviews30: 0,
      lessonsCompleted8w: 0,
      failingClasses: 2,
    });
    expect(low.band).toBe('support');
    expect(low.parts[2].score).toBe(0);
  });
});

describe('gaps, recommendations and paths', () => {
  it('finds gaps only among standards with evidence, weakest first', () => {
    expect(masteryGaps(rows).map((g) => g.code)).toEqual(['5.NF.1', '5.NF.2']);
  });

  it('ranks missing work first, then gap content, practice and the next lesson', () => {
    const recs = recommend({
      gaps: masteryGaps(rows),
      contentFor,
      missing: [
        { assignmentId: 'as1', title: 'Essay', href: '/assignments/as1' },
      ],
      practiceDue: 3,
      nextLessons: [
        {
          lessonId: 'l9',
          title: 'Decimals',
          courseTitle: 'Math 5',
          href: '/courses/lessons/l9',
        },
      ],
      tutorAllowed: true,
    });
    expect(recs.map((r) => r.kind)).toEqual([
      'assignment',
      'lesson',
      'tutor',
      'practice',
      'lesson',
    ]);
    expect(recs[1]).toMatchObject({ refId: 'l1', standardCode: '5.NF.1' });
    expect(recs[2].title).toContain('5.NF.2');
    const noTutor = recommend({
      gaps: masteryGaps(rows),
      contentFor,
      missing: [],
      practiceDue: 0,
      nextLessons: [],
      tutorAllowed: false,
    });
    expect(noTutor.map((r) => r.kind)).toEqual(['lesson']);
  });

  it('builds a path of content then practice per gap, without repeating content', () => {
    const steps = buildPathSteps(masteryGaps(rows), contentFor);
    expect(steps.map((s) => s.kind)).toEqual(['lesson', 'library', 'practice']);
    expect(steps[2].standardCode).toBe('5.NF.1');
    expect(pathTitle(masteryGaps(rows), 'Math')).toBe(
      'Math: strengthen 5.NF.1 and 5.NF.2',
    );
    expect(pathTitle([], null)).toBe('Keep going');
  });

  it('tracks progress and finishes steps from events', () => {
    const steps = [
      {
        id: 's1',
        kind: 'lesson',
        refId: 'l1',
        status: 'pending',
        sortOrder: 1,
      },
      { id: 's2', kind: 'h5p', refId: 'c1', status: 'pending', sortOrder: 2 },
      {
        id: 's3',
        kind: 'practice',
        refId: null,
        status: 'pending',
        sortOrder: 3,
      },
      {
        id: 's4',
        kind: 'practice',
        refId: null,
        status: 'pending',
        sortOrder: 4,
      },
    ];
    expect(stepsFinishedBy({ kind: 'lesson', refId: 'l1' }, steps)).toEqual([
      's1',
    ]);
    expect(
      stepsFinishedBy({ kind: 'h5p', refId: 'c1', fraction: 0.4 }, steps),
    ).toEqual([]);
    expect(
      stepsFinishedBy({ kind: 'h5p', refId: 'c1', fraction: 0.8 }, steps),
    ).toEqual(['s2']);
    expect(stepsFinishedBy({ kind: 'practice', refId: null }, steps)).toEqual([
      's3',
    ]);
    expect(
      pathProgress([
        { status: 'done' },
        { status: 'skipped' },
        { status: 'pending' },
      ]),
    ).toEqual({ total: 3, done: 2, percent: 67, complete: false });
    expect(pathProgress([{ status: 'done' }]).complete).toBe(true);
    expect(pathProgress([]).complete).toBe(false);
  });
});
