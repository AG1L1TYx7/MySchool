import {
  averageDailyAttendance,
  deadlinePassed,
  isChronicallyAbsent,
  localDate,
  meetsOn,
  parseGradeLevels,
  statusForCategory,
  validDays,
  validTime,
  within,
} from './school-rules';

describe('school rules', () => {
  it('parses grade levels with a K to 12 default', () => {
    expect(parseGradeLevels('k, 1 ,2')).toEqual(['K', '1', '2']);
    expect(parseGradeLevels(null)).toHaveLength(13);
  });

  it('matches period days to weekdays', () => {
    const monday = new Date('2026-10-05T12:00:00Z');
    const thursday = new Date('2026-10-08T12:00:00Z');
    const sunday = new Date('2026-10-04T12:00:00Z');
    expect(meetsOn('MTWRF', monday)).toBe(true);
    expect(meetsOn('MWF', thursday)).toBe(false);
    expect(meetsOn('R', thursday)).toBe(true);
    expect(meetsOn('MTWRF', sunday)).toBe(false);
    expect(validDays('MTWRF')).toBe(true);
    expect(validDays('MM')).toBe(false);
    expect(validDays('XYZ')).toBe(false);
    expect(validTime('08:05')).toBe(true);
    expect(validTime('8:05')).toBe(false);
  });

  it('keeps terms inside years', () => {
    const year = { start: new Date('2026-08-15'), end: new Date('2027-06-05') };
    expect(
      within(
        { start: new Date('2026-08-15'), end: new Date('2026-12-20') },
        year,
      ),
    ).toBe(true);
    expect(
      within(
        { start: new Date('2026-08-01'), end: new Date('2026-12-20') },
        year,
      ),
    ).toBe(false);
  });

  it('maps code categories to the legacy status and computes the federal measures', () => {
    expect(statusForCategory('TARDY', true)).toBe('TARDY');
    expect(statusForCategory('EXCUSED', false)).toBe('EXCUSED');
    expect(statusForCategory('UNEXCUSED', false)).toBe('ABSENT');
    expect(statusForCategory('OTHER', true)).toBe('PRESENT');
    expect(isChronicallyAbsent(100, 10)).toBe(true);
    expect(isChronicallyAbsent(100, 9)).toBe(false);
    expect(isChronicallyAbsent(0, 0)).toBe(false);
    expect(
      averageDailyAttendance([
        { present: 90, enrolled: 100 },
        { present: 50, enrolled: 50 },
      ]),
    ).toBe(93.33);
  });

  it('evaluates the daily deadline in the school timezone', () => {
    const noonUtc = new Date('2026-10-05T12:00:00Z'); // 07:00 in Chicago
    expect(deadlinePassed('10:00', noonUtc, 'America/Chicago')).toBe(false);
    expect(deadlinePassed('06:30', noonUtc, 'America/Chicago')).toBe(true);
    expect(deadlinePassed(null, noonUtc, 'America/Chicago')).toBe(false);
    expect(localDate(new Date('2026-10-05T03:00:00Z'), 'America/Chicago')).toBe(
      '2026-10-04',
    );
  });
});
