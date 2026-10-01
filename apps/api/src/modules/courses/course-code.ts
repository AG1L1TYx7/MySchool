/**
 * Course code suggestions: "Algebra I" -> "ALG-I", "English Language Arts 7" -> "ENG-LAN-7".
 * The caller appends a numeric suffix when the code is already taken.
 */
export function suggestCourseCode(title: string): string {
  const words = title
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !STOP_WORDS.has(w));
  const parts = words
    .slice(0, 3)
    .map((w) => (/^\d+$/.test(w) || /^[IVX]+$/.test(w) ? w : w.slice(0, 3)));
  return (parts.join('-') || 'COURSE').slice(0, 40);
}

const STOP_WORDS = new Set([
  'THE',
  'OF',
  'AND',
  'TO',
  'A',
  'AN',
  'IN',
  'FOR',
  'INTRODUCTION',
  'INTRO',
]);

/** Appends -2, -3, ... until `isFree` accepts the code. */
export async function uniqueCourseCode(
  base: string,
  isFree: (code: string) => Promise<boolean>,
): Promise<string> {
  if (await isFree(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (await isFree(candidate)) return candidate;
  }
  throw new Error('Could not allocate a course code');
}
