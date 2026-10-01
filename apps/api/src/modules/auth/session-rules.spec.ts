import { cookieMaxAgeMs, sessionExpiry } from './session-rules';

describe('session expiry rules', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  const day = 86_400_000;

  it('starts a family with an absolute limit and a shorter sliding window', () => {
    const e = sessionExpiry({ now, slidingDays: 7, absoluteDays: 30 });
    expect(e.expiresAt.getTime()).toBe(now.getTime() + 7 * day);
    expect(e.absoluteExpiresAt.getTime()).toBe(now.getTime() + 30 * day);
  });

  it('never slides past the family absolute limit', () => {
    const familyAbsolute = new Date(now.getTime() + 3 * day);
    const e = sessionExpiry({
      now,
      slidingDays: 7,
      absoluteDays: 30,
      familyAbsoluteExpiresAt: familyAbsolute,
    });
    expect(e.expiresAt).toEqual(familyAbsolute);
    expect(e.absoluteExpiresAt).toEqual(familyAbsolute);
  });

  it('computes a non-negative cookie age', () => {
    expect(cookieMaxAgeMs(new Date(now.getTime() + 1000), now)).toBe(1000);
    expect(cookieMaxAgeMs(new Date(now.getTime() - 1000), now)).toBe(0);
  });
});
