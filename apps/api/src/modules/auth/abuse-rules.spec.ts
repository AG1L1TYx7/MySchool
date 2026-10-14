import {
  isBlocked,
  mailAllowed,
  noteFailure,
  type AttemptWindow,
} from './abuse-rules';

describe('abuse rules (docs/21 F29, F39)', () => {
  it('blocks an address after too many wrong join codes until the window ends', () => {
    const windows = new Map<string, AttemptWindow>();
    const rule = { limit: 2, windowMs: 1000 };
    expect(noteFailure(windows, 'ip', 0, rule)).toBe(false);
    expect(noteFailure(windows, 'ip', 10, rule)).toBe(false);
    expect(noteFailure(windows, 'ip', 20, rule)).toBe(true);
    expect(isBlocked(windows, 'ip', 500, rule)).toBe(true);
    expect(isBlocked(windows, 'other', 500, rule)).toBe(false);
    expect(isBlocked(windows, 'ip', 1001, rule)).toBe(false);
    expect(noteFailure(windows, 'ip', 1001, rule)).toBe(false);
  });

  it('allows one mail per address per cooldown', () => {
    const sent = new Map<string, number>();
    expect(mailAllowed(sent, 'a@x', 0, 100)).toBe(true);
    expect(mailAllowed(sent, 'a@x', 50, 100)).toBe(false);
    expect(mailAllowed(sent, 'b@x', 50, 100)).toBe(true);
    expect(mailAllowed(sent, 'a@x', 100, 100)).toBe(true);
  });
});
