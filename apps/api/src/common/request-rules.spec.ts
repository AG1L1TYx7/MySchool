import {
  LOG_REDACT_PATHS,
  maskLoggedUrl,
  parseTrustProxy,
  throttleTracker,
} from './request-rules';

describe('request rules', () => {
  it('reads the trust proxy setting as a count, a boolean or a list', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toBe(
      'loopback, 10.0.0.0/8',
    );
  });

  it('masks secrets carried in logged URLs', () => {
    expect(maskLoggedUrl('/api/v1/calendar/ical/abc123.ics')).toBe(
      '/api/v1/calendar/ical/[token]',
    );
    expect(maskLoggedUrl('/api/v1/h5p/play/ticket.value/h5p.json')).toBe(
      '/api/v1/h5p/play/[ticket]/h5p.json',
    );
    expect(
      maskLoggedUrl('/api/v1/auth/sso/google/callback?code=4/abc&state=xyz'),
    ).toBe('/api/v1/auth/sso/google/callback?[redacted]');
    expect(maskLoggedUrl('/api/v1/lti/launch?id_token=eyJ')).toBe(
      '/api/v1/lti/launch?[redacted]',
    );
    expect(maskLoggedUrl('/api/v1/classes?page=2&access_token=abc')).toBe(
      '/api/v1/classes?page=2&access_token=[redacted]',
    );
    expect(maskLoggedUrl('/api/v1/students?search=Lo')).toBe(
      '/api/v1/students?search=Lo',
    );
    expect(maskLoggedUrl(undefined)).toBe('');
  });

  it('redacts the cookies the API sets and every token-bearing field', () => {
    expect(LOG_REDACT_PATHS).toEqual(
      expect.arrayContaining([
        'res.headers["set-cookie"]',
        'res.headers.location',
        'req.body.refreshToken',
        'req.body.mfaToken',
        'req.headers.cookie',
      ]),
    );
  });

  it('keys sign-in limits on address and account, everything else on the address', () => {
    expect(
      throttleTracker('203.0.113.9', '/api/v1/auth/login', {
        email: 'Ann@School.org',
      }),
    ).toBe('203.0.113.9|ann@school.org');
    expect(
      throttleTracker('203.0.113.9', '/api/v1/auth/2fa/challenge', {
        email: 'ann@school.org',
      }),
    ).toBe('203.0.113.9|ann@school.org');
    expect(throttleTracker('203.0.113.9', '/api/v1/auth/login', {})).toBe(
      '203.0.113.9',
    );
    expect(
      throttleTracker('203.0.113.9', '/api/v1/classes', { email: 'x@y.z' }),
    ).toBe('203.0.113.9');
    expect(throttleTracker(undefined, '/api/v1/classes', null)).toBe('unknown');
  });
});
