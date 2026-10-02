import { profileFrom } from './providers';
import {
  emailAllowedFor,
  newPkce,
  parseList,
  safeRedirect,
  signState,
  verifyState,
} from './sso-rules';

const SECRET = 'unit-test-secret-that-is-long-enough-0123456789';

describe('sso rules', () => {
  it('signs state that expires and cannot be altered', () => {
    const state = {
      provider: 'google' as const,
      nonce: 'n1',
      verifier: 'v1',
      redirectTo: '/grades',
      exp: Math.floor(Date.now() / 1000) + 60,
    };
    const token = signState(state, SECRET);
    expect(verifyState(token, SECRET)).toEqual(state);
    expect(
      verifyState(token, 'other-secret-that-is-long-enough-0123456789'),
    ).toBeNull();
    expect(verifyState(token, SECRET, (state.exp + 1) * 1000)).toBeNull();
    const [payload] = token.split('.');
    expect(verifyState(`${payload}.x`, SECRET)).toBeNull();
  });

  it('derives a PKCE challenge from a fresh verifier', () => {
    const a = newPkce();
    const b = newPkce();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('only redirects inside the app', () => {
    expect(safeRedirect('/classes/1')).toBe('/classes/1');
    expect(safeRedirect('https://evil.example')).toBe('/dashboard');
    expect(safeRedirect('//evil.example')).toBe('/dashboard');
    expect(safeRedirect(undefined)).toBe('/dashboard');
  });

  it('allows an email only when the provider is on and the domain matches', () => {
    const org = {
      id: 'o',
      providers: ['google' as const],
      allowedDomains: ['school.org'],
    };
    expect(emailAllowedFor('t@school.org', 'google', org)).toBe(true);
    expect(emailAllowedFor('t@School.ORG', 'google', org)).toBe(true);
    expect(emailAllowedFor('t@gmail.com', 'google', org)).toBe(false);
    expect(emailAllowedFor('t@school.org', 'microsoft', org)).toBe(false);
    expect(
      emailAllowedFor('t@anything.org', 'google', {
        ...org,
        allowedDomains: [],
      }),
    ).toBe(true);
    expect(parseList(' Google, microsoft ,, ')).toEqual([
      'google',
      'microsoft',
    ]);
  });

  it('normalises each provider profile', () => {
    expect(
      profileFrom('google', {
        sub: '1',
        email: 'A@B.org',
        given_name: 'A',
        family_name: 'B',
      }),
    ).toEqual({
      provider: 'google',
      subject: '1',
      email: 'a@b.org',
      firstName: 'A',
      lastName: 'B',
    });
    expect(
      profileFrom('microsoft', { sub: '2', preferred_username: 'x@y.org' })
        ?.email,
    ).toBe('x@y.org');
    expect(
      profileFrom('clever', {
        data: { id: 'c1', email: 'C@d.org', name: { first: 'C', last: 'D' } },
      }),
    ).toEqual({
      provider: 'clever',
      subject: 'c1',
      email: 'c@d.org',
      firstName: 'C',
      lastName: 'D',
    });
    expect(
      profileFrom('classlink', {
        UserId: 77,
        Email: 'e@f.org',
        FirstName: 'E',
        LastName: 'F',
      }),
    ).toEqual({
      provider: 'classlink',
      subject: '77',
      email: 'e@f.org',
      firstName: 'E',
      lastName: 'F',
    });
    expect(profileFrom('google', { email: 'no-subject@x.org' })).toBeNull();
  });
});
