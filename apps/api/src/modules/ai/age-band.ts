export type AgeBand = '5-7' | '8-10' | '11-13' | '14-18' | 'adult';

/** Age band from the date of birth when known, otherwise from the grade level (docs/10 section 7). */
export function ageBandFor(
  dateOfBirth: Date | null,
  gradeLevel: string | null,
  now = new Date(),
): AgeBand {
  if (dateOfBirth) {
    const age = Math.floor(
      (now.getTime() - dateOfBirth.getTime()) / (365.25 * 86_400_000),
    );
    if (age <= 7) return '5-7';
    if (age <= 10) return '8-10';
    if (age <= 13) return '11-13';
    if (age <= 18) return '14-18';
    return 'adult';
  }
  const g = (gradeLevel ?? '').trim().toUpperCase();
  if (!g) return '14-18';
  if (g === 'K' || g === '1' || g === '2') return '5-7';
  const n = Number(g);
  if (Number.isFinite(n)) {
    if (n <= 5) return '8-10';
    if (n <= 8) return '11-13';
    if (n <= 12) return '14-18';
  }
  return '14-18';
}
