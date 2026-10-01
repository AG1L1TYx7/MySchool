import { addRecord, emptyCounts, summarize } from './attendance-rules';

describe('attendance rules', () => {
  it('counts statuses and computes the attendance rate', () => {
    let c = emptyCounts();
    for (const s of [
      'present',
      'present',
      'late',
      'absent',
      'excused',
    ] as const)
      c = addRecord(c, s);
    expect(c).toMatchObject({
      present: 2,
      late: 1,
      absent: 1,
      excused: 1,
      total: 5,
      attendanceRate: 60,
    });
  });

  it('summarises per student', () => {
    const m = summarize([
      { studentId: 'a', status: 'present' },
      { studentId: 'a', status: 'tardy' },
      { studentId: 'b', status: 'absent' },
    ]);
    expect(m.get('a')).toMatchObject({ total: 2, attendanceRate: 100 });
    expect(m.get('b')).toMatchObject({
      total: 1,
      absent: 1,
      attendanceRate: 0,
    });
    expect(m.get('c')).toBeUndefined();
  });
});
