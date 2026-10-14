import { canSeeSensitiveStudentFields } from './students-rules';

describe('canSeeSensitiveStudentFields (docs/21 F14)', () => {
  const none = { own: false, teaches: false };
  it('lets administrators and counselors see them for the school', () => {
    for (const role of [
      'SUPER_ADMIN',
      'SUPERINTENDENT',
      'PRINCIPAL',
      'COUNSELOR',
    ] as const)
      expect(canSeeSensitiveStudentFields(role, none)).toBe(true);
  });
  it('lets a teacher see them only for a student they teach', () => {
    expect(canSeeSensitiveStudentFields('TEACHER', none)).toBe(false);
    expect(
      canSeeSensitiveStudentFields('TEACHER', { own: false, teaches: true }),
    ).toBe(true);
  });
  it('never shows them to assistants, and always to the student and guardian themselves', () => {
    expect(
      canSeeSensitiveStudentFields('ASSISTANT', { own: false, teaches: true }),
    ).toBe(false);
    expect(canSeeSensitiveStudentFields('STUDENT', none)).toBe(false);
    expect(
      canSeeSensitiveStudentFields('STUDENT', { own: true, teaches: false }),
    ).toBe(true);
    expect(
      canSeeSensitiveStudentFields('PARENT', { own: true, teaches: false }),
    ).toBe(true);
  });
});
