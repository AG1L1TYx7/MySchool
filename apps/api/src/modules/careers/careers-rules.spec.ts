import {
  canSeePortfolio,
  checklistFor,
  compareResult,
  gradeNumber,
  INVENTORY,
  isValidSlug,
  matchClusters,
  readinessPercent,
  resumeSections,
  scoreInventory,
  slugFor,
  summarizeRun,
} from './careers-rules';

const viewer = (
  over: Partial<Parameters<typeof canSeePortfolio>[1]>,
): Parameters<typeof canSeePortfolio>[1] => ({
  id: 'u1',
  role: 'STUDENT',
  organizationId: 'o1',
  isGuardian: false,
  teaches: false,
  ...over,
});

describe('portfolio visibility', () => {
  const p = {
    studentUserId: 'owner',
    organizationId: 'o1',
    visibility: 'private',
  };
  it('shows a private portfolio to the owner, guardians, their teachers and school staff only', () => {
    expect(canSeePortfolio(p, viewer({ id: 'owner' }))).toBe(true);
    expect(canSeePortfolio(p, viewer({ isGuardian: true }))).toBe(true);
    expect(canSeePortfolio(p, viewer({ role: 'TEACHER', teaches: true }))).toBe(
      true,
    );
    expect(canSeePortfolio(p, viewer({ role: 'TEACHER' }))).toBe(false);
    expect(canSeePortfolio(p, viewer({ role: 'COUNSELOR' }))).toBe(true);
    expect(
      canSeePortfolio(p, viewer({ role: 'PRINCIPAL', organizationId: 'o2' })),
    ).toBe(false);
    expect(canSeePortfolio(p, viewer({}))).toBe(false);
  });
  it('opens school and public portfolios by reach', () => {
    expect(canSeePortfolio({ ...p, visibility: 'school' }, viewer({}))).toBe(
      true,
    );
    expect(
      canSeePortfolio(
        { ...p, visibility: 'school' },
        viewer({ organizationId: 'o2' }),
      ),
    ).toBe(false);
    expect(
      canSeePortfolio(
        { ...p, visibility: 'public' },
        viewer({ organizationId: 'o2' }),
      ),
    ).toBe(true);
    expect(canSeePortfolio({ ...p, visibility: 'family' }, viewer({}))).toBe(
      false,
    );
  });
  it('makes and checks slugs', () => {
    expect(slugFor('Emma', "O'Brien", 'a1b2')).toBe('emma-o-brien-a1b2');
    expect(isValidSlug('emma-o-brien-a1b2')).toBe(true);
    expect(isValidSlug('admin')).toBe(false);
    expect(isValidSlug('-bad')).toBe(false);
  });
});

describe('interest inventory and clusters', () => {
  it('scores six codes from eighteen answers and ranks the top three', () => {
    const answers: Record<string, number> = {};
    for (const q of INVENTORY)
      answers[q.id] =
        q.code === 'I' ? 5 : q.code === 'R' ? 4 : q.code === 'S' ? 3 : 1;
    const r = scoreInventory(answers);
    expect(r.scores.I).toBe(15);
    expect(r.top).toEqual(['I', 'R', 'S']);
    expect(r.code).toBe('IRS');
    const clusters = matchClusters(r.top);
    expect(clusters[0].id).toBe('stem');
    expect(clusters.every((c) => c.fit > 0)).toBe(true);
    expect(() => scoreInventory({ r1: 5 })).toThrow(RangeError);
  });
});

describe('readiness checklist', () => {
  it('shows only the items for the grade and merges ticks', () => {
    expect(gradeNumber('K')).toBe(0);
    expect(gradeNumber('07')).toBe(7);
    expect(gradeNumber(null)).toBeNull();
    const seventh = checklistFor('7', [
      { key: 'interests', doneAt: '2026-10-01T00:00:00Z', byId: 'u1' },
    ]);
    expect(seventh.map((i) => i.key)).toEqual([
      'interests',
      'skills',
      'project',
    ]);
    expect(seventh[0]).toMatchObject({ done: true, byId: 'u1' });
    expect(readinessPercent(seventh)).toBe(33);
    expect(checklistFor('12', []).some((i) => i.key === 'fafsa')).toBe(true);
    expect(checklistFor(null, []).length).toBe(13);
  });
});

describe('resume and code tests', () => {
  it('prints only the sections with content, in order', () => {
    const s = resumeSections({
      student: {
        firstName: 'Emma',
        lastName: 'Johnson',
        gradeLevel: '7',
        email: null,
      },
      school: { name: 'Demo School', address: null },
      headline: 'Curious builder',
      about: null,
      projects: [
        {
          title: 'Bridge model',
          summary: 'Held 4 kg',
          kind: 'science',
          completedOn: new Date('2026-05-01T00:00:00Z'),
          skills: ['Problem solving'],
        },
      ],
      skills: [{ name: 'Coding', level: 3, endorsements: 2 }],
      badges: [],
      courses: [{ title: 'English 7', year: '2026-2027', letter: 'A' }],
      pathways: ['Information Technology'],
    });
    expect(s.map((x) => x.title)).toEqual([
      'Profile',
      'Education',
      'Courses',
      'Projects',
      'Skills',
      'Career interests',
    ]);
    expect(s[3].lines[0]).toBe(
      'Bridge model (2026): Held 4 kg [Problem solving]',
    );
    expect(s[4].lines[0]).toBe('Coding: proficient (2 endorsements)');
  });

  it('compares results as JSON with a tolerance for numbers and summarises a run', () => {
    expect(compareResult('5', 5)).toBe(true);
    expect(compareResult('0.75', 0.5 + 0.25)).toBe(true);
    expect(compareResult('"Fizz"', 'Fizz')).toBe(true);
    expect(compareResult('[1,2]', [1, 2])).toBe(true);
    expect(compareResult('true', 1)).toBe(false);
    expect(
      summarizeRun(
        [
          { label: 'a', passed: true, expected: '1', got: '1' },
          { label: 'b', passed: false, expected: '2', got: '3' },
        ],
        null,
      ),
    ).toEqual({ status: 'failed', passed: 1, total: 2 });
    expect(
      summarizeRun(
        [{ label: 'a', passed: true, expected: '1', got: '1' }],
        null,
      ).status,
    ).toBe('passed');
    expect(summarizeRun([], 'boom').status).toBe('error');
  });
});
