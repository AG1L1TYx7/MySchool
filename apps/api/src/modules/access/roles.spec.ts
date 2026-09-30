import {
  canAssignRole,
  hasMinimumLevel,
  roleFromApi,
  ROLE_API_NAME,
  ROLE_LEVEL,
} from './roles';

describe('role hierarchy', () => {
  it('orders roles as documented', () => {
    expect(ROLE_LEVEL.SUPER_ADMIN).toBeGreaterThan(ROLE_LEVEL.SUPERINTENDENT);
    expect(ROLE_LEVEL.SUPERINTENDENT).toBeGreaterThan(ROLE_LEVEL.PRINCIPAL);
    expect(ROLE_LEVEL.PRINCIPAL).toBeGreaterThan(ROLE_LEVEL.TEACHER);
    expect(ROLE_LEVEL.TEACHER).toBeGreaterThan(ROLE_LEVEL.STUDENT);
    expect(ROLE_LEVEL.STUDENT).toBeGreaterThan(ROLE_LEVEL.PARENT);
    expect(ROLE_LEVEL.PARENT).toBe(ROLE_LEVEL.ASSISTANT);
  });

  it('checks minimum level (TeacherOrAbove = 3)', () => {
    expect(hasMinimumLevel('TEACHER', 3)).toBe(true);
    expect(hasMinimumLevel('STUDENT', 3)).toBe(false);
    expect(hasMinimumLevel('SUPER_ADMIN', 3)).toBe(true);
  });

  it('round-trips API names', () => {
    for (const [role, api] of Object.entries(ROLE_API_NAME)) {
      expect(roleFromApi(api)).toBe(role);
    }
    expect(roleFromApi('wizard')).toBeUndefined();
  });

  it('limits who can assign which roles', () => {
    expect(canAssignRole('SUPER_ADMIN', 'SUPER_ADMIN')).toBe(true);
    expect(canAssignRole('SUPERINTENDENT', 'SUPER_ADMIN')).toBe(false);
    expect(canAssignRole('SUPERINTENDENT', 'PRINCIPAL')).toBe(true);
    expect(canAssignRole('PRINCIPAL', 'TEACHER')).toBe(true);
    expect(canAssignRole('PRINCIPAL', 'PRINCIPAL')).toBe(false);
    expect(canAssignRole('TEACHER', 'STUDENT')).toBe(false);
  });
});
