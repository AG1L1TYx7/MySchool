import type { Role } from '../../generated/prisma/client';

/**
 * Who may see a student's sensitive fields (docs/21 F14): date of birth, phone, address, accessibility
 * needs, goals and notes. Administrators and counselors see them for the school; a teacher only for a
 * student they teach; a student or guardian for their own record. Assistants never do: their work needs
 * names and classes, not home addresses.
 */
export const SENSITIVE_STUDENT_FIELDS = [
  'dateOfBirth',
  'phone',
  'address',
  'accessibilityNeeds',
  'goals',
  'notes',
] as const;

export function canSeeSensitiveStudentFields(
  role: Role,
  context: { own: boolean; teaches: boolean },
): boolean {
  if (context.own) return true;
  switch (role) {
    case 'SUPER_ADMIN':
    case 'SUPERINTENDENT':
    case 'PRINCIPAL':
    case 'COUNSELOR':
      return true;
    case 'TEACHER':
      return context.teaches;
    default:
      return false;
  }
}
