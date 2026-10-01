import {
  applyLatePenalty,
  buildGradebook,
  isLate,
  letterGrade,
  percentageOf,
  submissionWindow,
} from './grading-rules';

describe('grading rules', () => {
  it('computes percentages and letters', () => {
    expect(percentageOf(45, 50)).toBe(90);
    expect(percentageOf(1, 3)).toBe(33.33);
    expect(percentageOf(5, 0)).toBe(0);
    expect(
      ['A', 'B', 'C', 'D', 'F'].map((_, i) => letterGrade(95 - i * 10)),
    ).toEqual(['A', 'B', 'C', 'D', 'F']);
    expect(letterGrade(90)).toBe('A');
    expect(letterGrade(59.99)).toBe('F');
  });

  it('decides lateness and the submission window', () => {
    const due = new Date('2026-10-10T23:59:00Z');
    expect(isLate(new Date('2026-10-10T23:58:00Z'), due)).toBe(false);
    expect(isLate(new Date('2026-10-11T00:00:00Z'), due)).toBe(true);
    expect(isLate(new Date(), null)).toBe(false);
    const base = {
      status: 'PUBLISHED' as const,
      availableFrom: null,
      dueAt: due,
      allowLateUntil: new Date('2026-10-12T00:00:00Z'),
    };
    expect(
      submissionWindow({ ...base, now: new Date('2026-10-09T00:00:00Z') }),
    ).toEqual({ accepted: true, late: false });
    expect(
      submissionWindow({ ...base, now: new Date('2026-10-11T00:00:00Z') }),
    ).toEqual({ accepted: true, late: true });
    expect(
      submissionWindow({ ...base, now: new Date('2026-10-13T00:00:00Z') })
        .accepted,
    ).toBe(false);
    expect(
      submissionWindow({
        ...base,
        status: 'DRAFT',
        now: new Date('2026-10-09T00:00:00Z'),
      }).reason,
    ).toContain('not published');
    expect(
      submissionWindow({
        ...base,
        status: 'CLOSED',
        now: new Date('2026-10-09T00:00:00Z'),
      }).reason,
    ).toContain('closed');
    expect(
      submissionWindow({
        ...base,
        availableFrom: new Date('2026-10-20T00:00:00Z'),
        now: new Date('2026-10-09T00:00:00Z'),
      }).reason,
    ).toContain('not open');
    // no late window configured: late work is accepted and flagged
    expect(
      submissionWindow({
        ...base,
        allowLateUntil: null,
        now: new Date('2026-12-01T00:00:00Z'),
      }),
    ).toEqual({ accepted: true, late: true });
  });

  it('applies a late penalty against the maximum points, never below zero', () => {
    expect(applyLatePenalty(80, 100, true, 10)).toEqual({
      score: 70,
      penaltyApplied: 10,
    });
    expect(applyLatePenalty(80, 100, false, 10)).toEqual({
      score: 80,
      penaltyApplied: null,
    });
    expect(applyLatePenalty(5, 100, true, 10)).toEqual({
      score: 0,
      penaltyApplied: 10,
    });
    expect(applyLatePenalty(80, 100, true, null)).toEqual({
      score: 80,
      penaltyApplied: null,
    });
  });

  it('builds a weighted gradebook that ignores ungraded cells', () => {
    const students = [
      { id: 's1', studentNumber: '1', firstName: 'Ada', lastName: 'L' },
      { id: 's2', studentNumber: '2', firstName: 'Bob', lastName: 'M' },
    ];
    const assignments = [
      {
        id: 'a1',
        title: 'HW',
        category: 'Homework',
        maxPoints: 10,
        weight: 1,
        dueAt: null,
        status: 'PUBLISHED',
      },
      {
        id: 'a2',
        title: 'Test',
        category: 'Test',
        maxPoints: 100,
        weight: 2,
        dueAt: null,
        status: 'PUBLISHED',
      },
    ];
    const grades = [
      { assignmentId: 'a1', studentId: 's1', score: 10, maxPoints: 10 },
      { assignmentId: 'a2', studentId: 's1', score: 80, maxPoints: 100 },
      { assignmentId: 'a1', studentId: 's2', score: 5, maxPoints: 10 },
    ];
    const gb = buildGradebook(students, assignments, grades);
    expect(gb.rows[0]).toMatchObject({
      weightedScore: 170,
      weightedMax: 210,
      percentage: 80.95,
      letter: 'B',
    });
    expect(gb.rows[1]).toMatchObject({
      weightedScore: 5,
      weightedMax: 10,
      percentage: 50,
      letter: 'F',
    });
    expect(gb.rows[1].cells.a2).toBeNull();
    expect(gb.classAverage).toBeCloseTo(65.475, 1);
    expect(gb.perAssignmentAverage).toEqual({ a1: 75, a2: 80 });
    expect(buildGradebook(students, assignments, []).classAverage).toBeNull();
  });
});
