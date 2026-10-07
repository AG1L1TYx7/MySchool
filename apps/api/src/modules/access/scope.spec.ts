import type { AuthenticatedUser } from '../auth/auth.types';
import {
  assertOrganizationAccess,
  organizationScope,
  resolveOrganizationId,
} from './scope';

const actor = (
  role: AuthenticatedUser['role'],
  organizationId: string | null,
  tenantOrganizationIds?: string[],
): AuthenticatedUser => ({
  id: 'u',
  email: 'u@x',
  role,
  organizationId,
  sessionId: 's',
  mfaSetupRequired: false,
  tenantId: 't1',
  tenantOrganizationIds,
});

describe('organisation scope', () => {
  it('lets district roles see everything or narrow by request', () => {
    expect(organizationScope(actor('SUPER_ADMIN', null))).toEqual({});
    expect(
      organizationScope(actor('SUPERINTENDENT', 'o1', ['o1', 'o2']), 'o2'),
    ).toEqual({ organizationId: 'o2' });
  });

  it('keeps a superintendent inside their own district', () => {
    expect(
      organizationScope(actor('SUPERINTENDENT', 'o1', ['o1', 'o2'])),
    ).toEqual({ organizationId: { in: ['o1', 'o2'] } });
    expect(() =>
      organizationScope(actor('SUPERINTENDENT', 'o1', ['o1']), 'o9'),
    ).toThrow();
    expect(() =>
      assertOrganizationAccess(actor('SUPERINTENDENT', 'o1', ['o1']), 'o9'),
    ).toThrow();
    expect(() =>
      resolveOrganizationId(actor('SUPERINTENDENT', 'o1', ['o1']), 'o9'),
    ).toThrow();
  });

  it('confines school roles to their own organisation and ignores the request', () => {
    expect(organizationScope(actor('PRINCIPAL', 'o1'), 'o2')).toEqual({
      organizationId: 'o1',
    });
    expect(organizationScope(actor('TEACHER', null))).toEqual({
      organizationId: '__none__',
    });
  });

  it('resolves the organisation for new records', () => {
    expect(resolveOrganizationId(actor('PRINCIPAL', 'o1'), 'o2')).toBe('o1');
    expect(resolveOrganizationId(actor('SUPER_ADMIN', null), 'o2')).toBe('o2');
    expect(() => resolveOrganizationId(actor('SUPER_ADMIN', null))).toThrow();
    expect(() => resolveOrganizationId(actor('TEACHER', null))).toThrow();
  });

  it('asserts access', () => {
    expect(() =>
      assertOrganizationAccess(actor('PRINCIPAL', 'o1'), 'o2'),
    ).toThrow();
    expect(() =>
      assertOrganizationAccess(actor('PRINCIPAL', 'o1'), 'o1'),
    ).not.toThrow();
    expect(() =>
      assertOrganizationAccess(actor('SUPER_ADMIN', null), 'o2'),
    ).not.toThrow();
  });
});
