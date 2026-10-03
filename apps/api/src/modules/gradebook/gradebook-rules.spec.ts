import {
  buildWeightedGradebook,
  deriveMark,
  gpaOf,
  gpaPointsFor,
  letterFor,
  levelFor,
  parseCase,
  parseGradingScale,
  summariseStandards,
  validateGradingScale,
  weightWarning,
  type BookAssignment,
  type BookCategory,
} from './gradebook-rules';

const students = [
  { id: 's1', studentNumber: '1', firstName: 'Ava', lastName: 'Okafor' },
  { id: 's2', studentNumber: '2', firstName: 'Ben', lastName: 'Lee' },
];
const categories: BookCategory[] = [
  { id: 'hw', name: 'Homework', weight: 20, dropLowest: 1, sortOrder: 0 },
  { id: 'tests', name: 'Tests', weight: 80, dropLowest: 0, sortOrder: 1 },
];
const assignment = (
  id: string,
  categoryId: string | null,
  maxPoints = 10,
  isExtraCredit = false,
): BookAssignment => ({
  id,
  title: id,
  categoryId,
  categoryName: categoryId,
  maxPoints,
  weight: 1,
  isExtraCredit,
  dueAt: null,
  status: 'published',
});

describe('gradebook rules', () => {
  it('weights categories, drops the lowest homework and ignores a category with no grades', () => {
    const book = buildWeightedGradebook({
      students,
      categories,
      assignments: [
        assignment('h1', 'hw'),
        assignment('h2', 'hw'),
        assignment('h3', 'hw'),
        assignment('t1', 'tests', 100),
      ],
      grades: [
        { assignmentId: 'h1', studentId: 's1', score: 10, maxPoints: 10 },
        { assignmentId: 'h2', studentId: 's1', score: 2, maxPoints: 10 },
        { assignmentId: 'h3', studentId: 's1', score: 8, maxPoints: 10 },
        { assignmentId: 't1', studentId: 's1', score: 70, maxPoints: 100 },
        { assignmentId: 'h1', studentId: 's2', score: 5, maxPoints: 10 },
      ],
      marks: [],
    });
    const ava = book.rows[0];
    expect(ava.cells.h2.dropped).toBe(true);
    expect(ava.categories.find((c) => c.name === 'Homework')?.percentage).toBe(
      90,
    );
    expect(ava.percentage).toBe(74); // 90 * 0.2 + 70 * 0.8
    expect(ava.letter).toBe('C');
    const ben = book.rows[1];
    expect(
      ben.categories.find((c) => c.name === 'Tests')?.percentage,
    ).toBeNull();
    expect(ben.percentage).toBe(50); // only homework has grades, so it carries the full weight
    expect(book.mode).toBe('categories');
  });

  it('counts a Missing mark as zero and leaves Excused work out', () => {
    const book = buildWeightedGradebook({
      students: [students[0]],
      categories: [],
      assignments: [
        assignment('a', null),
        assignment('b', null),
        assignment('c', null),
      ],
      grades: [
        { assignmentId: 'a', studentId: 's1', score: 10, maxPoints: 10 },
      ],
      marks: [
        { assignmentId: 'b', studentId: 's1', mark: 'MISSING' },
        { assignmentId: 'c', studentId: 's1', mark: 'EXCUSED' },
      ],
    });
    const row = book.rows[0];
    expect(row.cells.b).toMatchObject({ score: 0, mark: 'missing' });
    expect(row.cells.c).toMatchObject({ score: null, mark: 'excused' });
    expect(row.percentage).toBe(50);
    expect(row.missing).toBe(1);
    expect(book.mode).toBe('points');
  });

  it('adds extra credit without raising the possible points', () => {
    const book = buildWeightedGradebook({
      students: [students[0]],
      categories: [
        {
          id: 'hw',
          name: 'Homework',
          weight: 100,
          dropLowest: 0,
          sortOrder: 0,
        },
      ],
      assignments: [
        assignment('a', 'hw', 10),
        assignment('bonus', 'hw', 5, true),
      ],
      grades: [
        { assignmentId: 'a', studentId: 's1', score: 8, maxPoints: 10 },
        { assignmentId: 'bonus', studentId: 's1', score: 2, maxPoints: 5 },
      ],
      marks: [],
    });
    expect(book.rows[0].categories[0]).toMatchObject({
      earned: 10,
      possible: 10,
      percentage: 100,
    });
    expect(book.rows[0].cells.bonus.extraCredit).toBe(true);
  });

  it('never drops the only graded item and warns about weights', () => {
    const book = buildWeightedGradebook({
      students: [students[0]],
      categories: [
        {
          id: 'hw',
          name: 'Homework',
          weight: 100,
          dropLowest: 2,
          sortOrder: 0,
        },
      ],
      assignments: [assignment('a', 'hw')],
      grades: [{ assignmentId: 'a', studentId: 's1', score: 3, maxPoints: 10 }],
      marks: [],
    });
    expect(book.rows[0].cells.a.dropped).toBe(false);
    expect(book.rows[0].percentage).toBe(30);
    expect(weightWarning([{ weight: 20 }, { weight: 30 }])).toContain('50');
    expect(weightWarning(categories)).toBeNull();
  });

  it('derives Google Classroom marks', () => {
    const due = new Date('2026-10-01T00:00:00Z');
    const base = {
      override: null,
      hasGrade: false,
      submitted: false,
      late: false,
      dueAt: due,
    };
    expect(deriveMark({ ...base, now: new Date('2026-09-30T00:00:00Z') })).toBe(
      'assigned',
    );
    expect(deriveMark({ ...base, now: new Date('2026-10-02T00:00:00Z') })).toBe(
      'missing',
    );
    expect(deriveMark({ ...base, submitted: true })).toBe('turned_in');
    expect(deriveMark({ ...base, submitted: true, late: true })).toBe('late');
    expect(deriveMark({ ...base, submitted: true, hasGrade: true })).toBe(
      'returned',
    );
    expect(deriveMark({ ...base, override: 'EXCUSED', hasGrade: true })).toBe(
      'excused',
    );
  });

  it('applies organisation letter, GPA and proficiency scales', () => {
    const scale = parseGradingScale(
      JSON.stringify([
        { letter: 'P', min: 70 },
        { letter: 'N', min: 0 },
      ]),
    );
    expect(letterFor(72, scale)).toBe('P');
    expect(letterFor(69.9, scale)).toBe('N');
    expect(letterFor(85)).toBe('B');
    expect(parseGradingScale('nonsense')[0].letter).toBe('A');
    expect(
      validateGradingScale([
        { letter: 'A', min: 90 },
        { letter: 'B', min: 50 },
      ]),
    ).toContain('lowest');
    expect(
      validateGradingScale([
        { letter: 'A', min: 90 },
        { letter: 'A', min: 0 },
      ]),
    ).toContain('once');
    expect(
      validateGradingScale([
        { letter: 'A', min: 90 },
        { letter: 'F', min: 0 },
      ]),
    ).toBeNull();
    expect(gpaPointsFor('B')).toBe(3);
    expect(gpaPointsFor('Z')).toBeNull();
    expect(
      gpaOf([{ gpaPoints: 4 }, { gpaPoints: 3 }, { gpaPoints: null }]),
    ).toBe(3.5);
    expect(levelFor(97).label).toBe('Advanced');
    expect(levelFor(10).level).toBe(1);
  });

  it('summarises standards by latest, best and average', () => {
    const summary = summariseStandards([
      {
        studentId: 's1',
        standardId: 'x',
        level: 2,
        gradedAt: new Date('2026-09-01'),
      },
      {
        studentId: 's1',
        standardId: 'x',
        level: 4,
        gradedAt: new Date('2026-09-10'),
      },
      {
        studentId: 's1',
        standardId: 'x',
        level: 3,
        gradedAt: new Date('2026-09-20'),
      },
    ]);
    expect(summary.get('s1')?.get('x')).toEqual({
      standardId: 'x',
      latest: 3,
      best: 4,
      average: 3,
      attempts: 3,
    });
  });

  it('reads a CASE package into a set with a tree', () => {
    const doc = parseCase({
      CFDocument: {
        identifier: 'doc',
        title: 'Common Core Mathematics',
        subjectTitle: ['Mathematics'],
        creator: 'CCSSO',
        version: '2010',
        officialSourceURL: 'https://example.org/ccss',
      },
      CFItems: [
        {
          identifier: 'a',
          humanCodingScheme: 'CCSS.MATH.CONTENT.7.EE',
          fullStatement: 'Expressions and Equations',
          educationLevel: ['07'],
        },
        {
          identifier: 'b',
          humanCodingScheme: 'CCSS.MATH.CONTENT.7.EE.A.1',
          fullStatement: 'Apply properties of operations.',
          educationLevel: ['07'],
        },
        { identifier: 'c', fullStatement: '' },
      ],
      CFAssociations: [
        {
          associationType: 'isChildOf',
          originNodeURI: { identifier: 'b' },
          destinationNodeURI: { identifier: 'a' },
        },
        {
          associationType: 'isChildOf',
          originNodeURI: { identifier: 'a' },
          destinationNodeURI: { identifier: 'doc' },
        },
      ],
    });
    expect(doc.name).toBe('Common Core Mathematics');
    expect(doc.code).toBe('COMMON-CORE-MATHEMATICS');
    expect(doc.standards).toHaveLength(2);
    expect(doc.standards[1]).toMatchObject({
      code: 'CCSS.MATH.CONTENT.7.EE.A.1',
      parentIdentifier: 'a',
      gradeLevels: '7',
    });
    expect(() => parseCase({})).toThrow('Not a CASE package');
  });
});
