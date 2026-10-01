import { ageBandFor } from './age-band';

describe('ageBandFor', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  it('uses the date of birth when known', () => {
    expect(ageBandFor(new Date('2020-05-01'), null, now)).toBe('5-7');
    expect(ageBandFor(new Date('2016-05-01'), '7', now)).toBe('8-10');
    expect(ageBandFor(new Date('2013-04-12'), null, now)).toBe('11-13');
    expect(ageBandFor(new Date('2009-01-01'), null, now)).toBe('14-18');
    expect(ageBandFor(new Date('1990-01-01'), null, now)).toBe('adult');
  });
  it('falls back to the grade level, and to the safest teen band when unknown', () => {
    expect(ageBandFor(null, 'K')).toBe('5-7');
    expect(ageBandFor(null, '4')).toBe('8-10');
    expect(ageBandFor(null, '7')).toBe('11-13');
    expect(ageBandFor(null, '11')).toBe('14-18');
    expect(ageBandFor(null, null)).toBe('14-18');
  });
});
