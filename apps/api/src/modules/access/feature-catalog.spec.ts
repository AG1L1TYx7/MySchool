import { FEATURE_CATALOG } from './feature-catalog';

describe('feature catalogue', () => {
  it('has unique, well-formed codes', () => {
    const codes = FEATURE_CATALOG.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
    }
  });

  it('gives every feature at least one default role', () => {
    for (const d of FEATURE_CATALOG) {
      expect(d.roles.length).toBeGreaterThan(0);
    }
  });

  it('keeps students out of administrative features', () => {
    const adminOnly = FEATURE_CATALOG.filter(
      (d) => d.category === 'Administration' || d.category === 'Users',
    );
    for (const d of adminOnly) {
      expect(d.roles).not.toContain('STUDENT');
      expect(d.roles).not.toContain('PARENT');
    }
  });
});
