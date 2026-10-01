import { isCommonPassword, PasswordService } from './password.service';

describe('password policy', () => {
  const svc = new PasswordService();

  it('rejects common passwords even when they satisfy the character classes', () => {
    expect(isCommonPassword('Password2026!')).toBe(true);
    expect(isCommonPassword('P@ssw0rd!!2026')).toBe(true);
    expect(isCommonPassword('Welcome-123456')).toBe(true);
    expect(isCommonPassword('SmartSchool!2026')).toBe(true);
    expect(isCommonPassword('Correct-Horse-Battery-9')).toBe(false);
    expect(svc.validateNewPassword('Password2026!')).toContain('too common');
  });

  it('rejects passwords containing the email or name', () => {
    expect(
      svc.validateNewPassword('Jane.Teacher!2026', {
        email: 'jane.teacher@school.edu',
      }),
    ).toContain('name or email');
    expect(
      svc.validateNewPassword('Lovelace#Ada2026', {
        firstName: 'Ada',
        lastName: 'Lovelace',
      }),
    ).toContain('name or email');
    expect(
      svc.validateNewPassword('Orbital-Mechanics-7!', {
        email: 'ada@school.edu',
        firstName: 'Ada',
      }),
    ).toBeNull();
  });

  it('rejects long repeated runs and short or single-class passwords', () => {
    expect(svc.validateNewPassword('Aaaaa-bbbbb-1!')).toContain('repeat');
    expect(svc.validateNewPassword('short1!A')).toContain('12 to 128');
    expect(svc.validateNewPassword('alllowercaseletters1!')).toContain(
      '12 to 128',
    );
  });
});
