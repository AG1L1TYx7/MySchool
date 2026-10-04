import { Role } from '../../generated/prisma/client';

/** Coarse authorisation hierarchy (docs/01 section 2). Higher means more authority. */
export const ROLE_LEVEL: Record<Role, number> = {
  SUPER_ADMIN: 6,
  SUPERINTENDENT: 5,
  PRINCIPAL: 4,
  TEACHER: 3,
  STUDENT: 2,
  PARENT: 1,
  ASSISTANT: 1,
  COUNSELOR: 3,
};

/** API representation of roles: lowercase strings (docs/09). */
export const ROLE_API_NAME: Record<Role, string> = {
  SUPER_ADMIN: 'super_admin',
  SUPERINTENDENT: 'superintendent',
  PRINCIPAL: 'principal',
  TEACHER: 'teacher',
  STUDENT: 'student',
  PARENT: 'parent',
  ASSISTANT: 'assistant',
  COUNSELOR: 'counselor',
};

export function roleFromApi(value: string): Role | undefined {
  const entry = (Object.entries(ROLE_API_NAME) as [Role, string][]).find(
    ([, api]) => api === value,
  );
  return entry?.[0];
}

export function hasMinimumLevel(role: Role, level: number): boolean {
  return ROLE_LEVEL[role] >= level;
}

/** Roles a user may self-register as. Staff and admin roles are created by administrators. */
export const SELF_REGISTER_ROLES: readonly Role[] = ['STUDENT', 'PARENT'];

/** Which roles an actor may assign to others. */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (actor === 'SUPER_ADMIN') return true;
  if (actor === 'SUPERINTENDENT') return target !== 'SUPER_ADMIN';
  if (actor === 'PRINCIPAL') return ROLE_LEVEL[target] <= ROLE_LEVEL.TEACHER;
  return false;
}
