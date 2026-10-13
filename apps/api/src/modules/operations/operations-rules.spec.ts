import {
  canTransition,
  componentsFromHealth,
  ipAllowed,
  ipInCidr,
  isValidCidr,
  mfaRequiredByPolicy,
  overallStatus,
  parseSecurityPolicy,
  parseUpdates,
  passwordLongEnough,
  SECURITY_DEFAULTS,
  sessionTooOld,
  uptimeByDay,
  uptimeOverall,
} from './operations-rules';

const now = new Date('2026-10-13T12:00:00Z');

describe('operations rules', () => {
  it('turns a health report into components and the components into one overall state', () => {
    const healthy = componentsFromHealth({
      status: 'healthy',
      checks: {
        database: { status: 'up' },
        aiService: { status: 'up' },
        redis: { status: 'disabled' },
      },
    });
    expect(healthy).toEqual({
      api: 'operational',
      database: 'operational',
      ai: 'operational',
      web: 'operational',
    });
    expect(overallStatus(healthy, [])).toBe('operational');
    const aiDown = componentsFromHealth({
      status: 'degraded',
      checks: {
        database: { status: 'up' },
        aiService: { status: 'down' },
        redis: { status: 'disabled' },
      },
    });
    expect(overallStatus(aiDown, [])).toBe('partial_outage');
    const dbDown = componentsFromHealth({
      status: 'unhealthy',
      checks: {
        database: { status: 'down' },
        aiService: { status: 'up' },
        redis: { status: 'disabled' },
      },
    });
    expect(overallStatus(dbDown, [])).toBe('major_outage');
    expect(
      overallStatus(healthy, [
        { kind: 'incident', status: 'investigating', impact: 'minor' },
      ]),
    ).toBe('degraded');
    expect(
      overallStatus(healthy, [
        { kind: 'incident', status: 'resolved', impact: 'critical' },
      ]),
    ).toBe('operational');
    expect(
      overallStatus(healthy, [
        { kind: 'maintenance', status: 'in_progress', impact: 'none' },
      ]),
    ).toBe('maintenance');
    expect(
      overallStatus(healthy, [
        { kind: 'maintenance', status: 'scheduled', impact: 'none' },
      ]),
    ).toBe('operational');
  });

  it('allows only the sensible incident moves', () => {
    expect(canTransition('investigating', 'identified')).toBe(true);
    expect(canTransition('monitoring', 'resolved')).toBe(true);
    expect(canTransition('resolved', 'investigating')).toBe(false);
    expect(canTransition('scheduled', 'in_progress')).toBe(true);
    expect(canTransition('completed', 'scheduled')).toBe(false);
  });

  it('computes uptime per day from checks, leaving days without checks blank', () => {
    const checks = [
      { checkedAt: new Date('2026-10-13T01:00:00Z'), status: 'healthy' },
      { checkedAt: new Date('2026-10-13T02:00:00Z'), status: 'unhealthy' },
      { checkedAt: new Date('2026-10-13T03:00:00Z'), status: 'degraded' },
      { checkedAt: new Date('2026-10-12T03:00:00Z'), status: 'healthy' },
    ];
    const days = uptimeByDay(checks, 3, now);
    expect(days.map((d) => d.day)).toEqual([
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
    ]);
    expect(days.map((d) => d.percent)).toEqual([null, 100, 66.67]);
    expect(uptimeOverall(days)).toBe(83.34);
    expect(uptimeOverall([{ percent: null }])).toBeNull();
  });

  it('reads update logs leniently', () => {
    expect(
      parseUpdates(
        '[{"at":"2026-10-13T00:00:00Z","status":"investigating","message":"Looking","byId":null},{"bad":1}]',
      ),
    ).toHaveLength(1);
    expect(parseUpdates('not json')).toEqual([]);
  });

  describe('security policy', () => {
    it('parses with floors and ceilings and drops bad entries', () => {
      expect(parseSecurityPolicy(undefined)).toEqual(SECURITY_DEFAULTS);
      const p = parseSecurityPolicy({
        passwordMinLength: 8,
        mfaRequiredRoles: ['principal', 'Bad Role', 'teacher'],
        sessionMaxHours: 99999,
        adminIpAllowlist: ['10.0.0.0/8', '999.1.1.1', '203.0.113.5'],
      });
      expect(p.passwordMinLength).toBe(12);
      expect(p.mfaRequiredRoles).toEqual(['principal', 'teacher']);
      expect(p.sessionMaxHours).toBe(24 * 90);
      expect(p.adminIpAllowlist).toEqual(['10.0.0.0/8', '203.0.113.5']);
      expect(
        parseSecurityPolicy({ passwordMinLength: 16 }).passwordMinLength,
      ).toBe(16);
    });
    it('checks passwords, 2FA roles and session age', () => {
      const p = parseSecurityPolicy({
        passwordMinLength: 16,
        mfaRequiredRoles: ['teacher'],
        sessionMaxHours: 8,
      });
      expect(passwordLongEnough(p, 'Correct-Horse-9!')).toBe(true);
      expect(passwordLongEnough(p, 'Short-Horse-9!')).toBe(false);
      expect(mfaRequiredByPolicy(p, 'teacher')).toBe(true);
      expect(mfaRequiredByPolicy(p, 'student')).toBe(false);
      expect(
        sessionTooOld(p, new Date(now.getTime() - 9 * 3_600_000), now),
      ).toBe(true);
      expect(
        sessionTooOld(p, new Date(now.getTime() - 7 * 3_600_000), now),
      ).toBe(false);
      expect(
        sessionTooOld(SECURITY_DEFAULTS, new Date('2020-01-01'), now),
      ).toBe(false);
    });
    it('matches IPv4 ranges and holds only administrators to the allowlist', () => {
      expect(isValidCidr('10.0.0.0/8')).toBe(true);
      expect(isValidCidr('10.0.0.0/33')).toBe(false);
      expect(ipInCidr('10.20.30.40', '10.0.0.0/8')).toBe(true);
      expect(ipInCidr('11.0.0.1', '10.0.0.0/8')).toBe(false);
      expect(ipInCidr('::ffff:203.0.113.5', '203.0.113.5')).toBe(true);
      expect(ipInCidr('203.0.113.6', '203.0.113.5')).toBe(false);
      expect(ipInCidr('2001:db8::1', '10.0.0.0/8')).toBe(false);
      const p = parseSecurityPolicy({ adminIpAllowlist: ['203.0.113.0/24'] });
      expect(ipAllowed(p, 'principal', '203.0.113.9')).toBe(true);
      expect(ipAllowed(p, 'principal', '198.51.100.9')).toBe(false);
      expect(ipAllowed(p, 'principal', null)).toBe(false);
      expect(ipAllowed(p, 'teacher', '198.51.100.9')).toBe(true);
      expect(ipAllowed(p, 'principal', '127.0.0.1')).toBe(true);
      expect(ipAllowed(SECURITY_DEFAULTS, 'principal', '198.51.100.9')).toBe(
        true,
      );
    });
  });
});
