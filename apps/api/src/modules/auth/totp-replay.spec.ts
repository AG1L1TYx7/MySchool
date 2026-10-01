import { base32Encode, matchTotpStep, totp, totpStep } from './totp';

const SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('TOTP replay protection', () => {
  it('reports the matched step so a code cannot be accepted twice', () => {
    const now = 1_800_000_000_000;
    const code = totp(SECRET, now);
    const step = matchTotpStep(SECRET, code, 1, now);
    expect(step).toBe(totpStep(now));
    // The same code one step later still matches (drift window) but at the same step value,
    // so a caller that stores `step` and requires a greater one rejects the replay.
    expect(matchTotpStep(SECRET, code, 1, now + 30_000)).toBe(step);
    expect(matchTotpStep(SECRET, code, 1, now + 90_000)).toBeNull();
    expect(matchTotpStep(SECRET, 'abc', 1, now)).toBeNull();
  });
});
