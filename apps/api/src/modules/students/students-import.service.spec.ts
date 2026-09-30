import {
  normaliseGrade,
  StudentsImportService,
} from './students-import.service';

describe('StudentsImportService.parse', () => {
  const svc = new StudentsImportService();

  it('accepts flexible headers and normalises values', () => {
    const csv = [
      'Student ID,First Name,Last Name,Email,DOB,Grade,Status,Parent Email,Relationship',
      'S-001,Ada,Lovelace,ADA@School.edu,2012-12-10,Grade 7,Active,mum@example.com,Mother',
      'S-002,Alan,Turing,,,K,,,',
    ].join('\n');
    const result = svc.parse(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      line: 2,
      studentNumber: 'S-001',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@school.edu',
      gradeLevel: '7',
      enrollmentStatus: 'active',
      guardianEmail: 'mum@example.com',
      guardianRelationship: 'mother',
    });
    expect(result.rows[0].dateOfBirth?.toISOString()).toBe(
      '2012-12-10T00:00:00.000Z',
    );
    expect(result.rows[1]).toMatchObject({
      studentNumber: 'S-002',
      gradeLevel: 'K',
      email: undefined,
      enrollmentStatus: undefined,
    });
  });

  it('reports missing required columns once', () => {
    const result = svc.parse('firstName,lastName\nAda,Lovelace\n');
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      { line: 1, message: 'Missing required column(s): studentNumber.' },
    ]);
  });

  it('reports row-level problems with line numbers and keeps good rows', () => {
    const csv = [
      'studentNumber,firstName,lastName,email,dateOfBirth,enrollmentStatus',
      'S1,Ada,Lovelace,not-an-email,2012-13-40,active',
      'S1,Bob,Dup,,,',
      ',NoNumber,X,,,',
      'S2,Good,Row,,2010-01-31,graduated',
    ].join('\n');
    const result = svc.parse(csv);
    expect(result.rows.map((r) => r.studentNumber)).toEqual(['S2']);
    expect(result.errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(result.errors[0].message).toContain('email');
    expect(result.errors[0].message).toContain('dateOfBirth');
    expect(result.errors[1].message).toContain('more than once');
    expect(result.errors[2].message).toContain('studentNumber is required');
  });

  it('rejects empty files', () => {
    expect(svc.parse('').errors[0].message).toBe('The file is empty.');
  });

  it('normalises grade levels', () => {
    expect(normaliseGrade('Grade 07')).toBe('7');
    expect(normaliseGrade('7th')).toBe('7');
    expect(normaliseGrade('kindergarten')).toBe('K');
    expect(normaliseGrade('Year 10')).toBe('10');
    expect(normaliseGrade('Sixth Form')).toBe('Sixth Form');
  });
});
