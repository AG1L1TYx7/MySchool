import { suggestCourseCode, uniqueCourseCode } from './course-code';

describe('course codes', () => {
  it('suggests short codes from titles', () => {
    expect(suggestCourseCode('Algebra I')).toBe('ALG-I');
    expect(suggestCourseCode('English Language Arts 7')).toBe('ENG-LAN-ART');
    expect(suggestCourseCode('Introduction to the Sciences')).toBe('SCI');
    expect(suggestCourseCode('!!!')).toBe('COURSE');
  });

  it('appends a counter until the code is free', async () => {
    const taken = new Set(['ALG-I', 'ALG-I-2']);
    expect(
      await uniqueCourseCode('ALG-I', (c) => Promise.resolve(!taken.has(c))),
    ).toBe('ALG-I-3');
    expect(await uniqueCourseCode('NEW', () => Promise.resolve(true))).toBe(
      'NEW',
    );
  });
});
