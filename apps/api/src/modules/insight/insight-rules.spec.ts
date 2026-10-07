import {
  aiUsageSummary,
  attendanceRate,
  completeness,
  gradeBuckets,
  missingByGradeLevel,
  nextRunAt,
  reportFileName,
  riskFlags,
  toCsv,
  transcriptSummary,
  weeklyCounts,
} from './insight-rules';

describe('insight rules', () => {
  it('buckets grades into five bands and rounds first', () => {
    const b = gradeBuckets([95, 89.6, 72, 60, 59.4, 0, 150]);
    expect(b.map((x) => x.count)).toEqual([3, 0, 1, 1, 2, 0].slice(0, 5));
    expect(b[0].label).toBe('90-100');
    expect(b[4].label).toBe('Below 60');
  });

  it('computes attendance rate from present-like statuses', () => {
    expect(attendanceRate([])).toBeNull();
    expect(attendanceRate(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'])).toBe(50);
    expect(attendanceRate(['PRESENT', 'PRESENT', 'TARDY'])).toBe(100);
  });

  it('flags risk from grade, missing work and attendance', () => {
    expect(riskFlags({ grade: 85, missing: 0, attendanceRate: 97 })).toEqual(
      [],
    );
    expect(riskFlags({ grade: 55, missing: 3, attendanceRate: 80 })).toEqual([
      'failing',
      'missing_work',
      'attendance',
    ]);
    expect(
      riskFlags({ grade: null, missing: 2, attendanceRate: null }),
    ).toEqual([]);
  });

  it('measures gradebook completeness and groups missing work by grade level', () => {
    expect(completeness(0, 0)).toBeNull();
    expect(completeness(45, 60)).toBe(75);
    expect(completeness(70, 60)).toBe(100);
    const rows = missingByGradeLevel([
      { gradeLevel: '9', studentId: 'a' },
      { gradeLevel: '9', studentId: 'a' },
      { gradeLevel: 'K', studentId: 'b' },
      { gradeLevel: null, studentId: 'c' },
    ]);
    expect(rows.map((r) => r.gradeLevel)).toEqual(['K', '9', 'Unknown']);
    expect(rows[1]).toEqual({ gradeLevel: '9', items: 2, students: 1 });
  });

  it('finds the next run for daily, weekly and monthly schedules', () => {
    const from = new Date('2026-10-06T12:00:00Z'); // a Tuesday
    expect(nextRunAt({ frequency: 'daily', hour: 7 }, from).toISOString()).toBe(
      '2026-10-07T07:00:00.000Z',
    );
    expect(
      nextRunAt({ frequency: 'daily', hour: 15 }, from).toISOString(),
    ).toBe('2026-10-06T15:00:00.000Z');
    expect(
      nextRunAt(
        { frequency: 'weekly', dayOfWeek: 1, hour: 7 },
        from,
      ).toISOString(),
    ).toBe('2026-10-12T07:00:00.000Z');
    expect(
      nextRunAt(
        { frequency: 'weekly', dayOfWeek: 2, hour: 13 },
        from,
      ).toISOString(),
    ).toBe('2026-10-06T13:00:00.000Z');
    expect(
      nextRunAt(
        { frequency: 'monthly', dayOfMonth: 31, hour: 7 },
        from,
      ).toISOString(),
    ).toBe('2026-10-31T07:00:00.000Z');
    expect(
      nextRunAt(
        { frequency: 'monthly', dayOfMonth: 31, hour: 7 },
        new Date('2026-11-01T00:00:00Z'),
      ).toISOString(),
    ).toBe('2026-11-30T07:00:00.000Z');
  });

  it('writes CSV with quoting, a BOM and CRLF, and names files safely', () => {
    const csv = toCsv(
      ['Name', 'Note'],
      [
        ['Doe, Jane', 'said "hi"'],
        ['Ann', null],
      ],
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe(
      'Name,Note\r\n"Doe, Jane","said ""hi"""\r\nAnn,\r\n',
    );
    expect(
      reportFileName(
        'Missing work',
        new Date('2026-10-06T00:00:00Z'),
        'Algebra I / A',
      ),
    ).toBe('missing-work-algebra-i-a-2026-10-06.csv');
  });

  it('builds a transcript by year with per-year and cumulative GPA', () => {
    const line = (
      yearName: string,
      periodStart: string,
      courseTitle: string,
      gpaPoints: number | null,
    ) => ({
      yearName,
      termName: 'Fall',
      periodName: 'Q1',
      periodStart,
      courseTitle,
      className: courseTitle,
      teacherName: null,
      percentage: null,
      letter: null,
      gpaPoints,
    });
    const t = transcriptSummary([
      line('2026-2027', '2026-08-20', 'Algebra I', 4),
      line('2025-2026', '2025-08-20', 'Pre-Algebra', 3),
      line('2026-2027', '2026-08-20', 'English 9', 3),
      line('2026-2027', '2026-10-20', 'Art', null),
    ]);
    expect(t.years.map((y) => y.yearName)).toEqual(['2025-2026', '2026-2027']);
    expect(t.years[1].gpa).toBe(3.5);
    expect(t.cumulativeGpa).toBe(3.33);
    expect(t.courses).toBe(4);
  });

  it('counts events per week and summarises AI usage by role', () => {
    const now = new Date('2026-10-06T12:00:00Z');
    const weeks = weeklyCounts(
      [
        new Date('2026-10-05T10:00:00Z'),
        new Date('2026-09-29T10:00:00Z'),
        new Date('2026-01-01T00:00:00Z'),
      ],
      4,
      now,
    );
    expect(weeks.map((w) => w.weekStart)).toEqual([
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
      '2026-10-05',
    ]);
    expect(weeks.map((w) => w.count)).toEqual([0, 0, 1, 1]);
    const ai = aiUsageSummary([
      { role: 'STUDENT', messageCount: 10, refused: 1 },
      { role: 'STUDENT', messageCount: 5, refused: 0 },
      { role: 'TEACHER', messageCount: 3, refused: 0 },
    ]);
    expect(ai).toMatchObject({
      conversations: 3,
      messages: 18,
      refusals: 1,
      refusalRate: 5.6,
    });
    expect(ai.byRole[0]).toEqual({
      role: 'STUDENT',
      conversations: 2,
      messages: 15,
    });
  });
});
