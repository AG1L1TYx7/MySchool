/**
 * Careers and portfolio (slice 24, docs/02 sections 28 and 34): who may see a portfolio, the interest
 * inventory and its career clusters, the readiness checklist by grade, skill levels, what goes on a
 * resume, and how code lesson tests are judged. Pure functions; the services read and write.
 */

import type { Role } from '../../generated/prisma/client';

// ---------------------------------------------------------------------------
// Portfolio visibility
// ---------------------------------------------------------------------------

export const PORTFOLIO_VISIBILITIES = [
  'private',
  'family',
  'school',
  'public',
] as const;
export type PortfolioVisibility = (typeof PORTFOLIO_VISIBILITIES)[number];
export const PROJECT_KINDS = [
  'project',
  'writing',
  'art',
  'code',
  'science',
  'service',
  'other',
] as const;

export interface PortfolioViewer {
  id: string;
  role: Role;
  organizationId: string | null;
  isGuardian: boolean;
  teaches: boolean;
}

/** Owner, guardians, their teachers, counselors and school administrators see every portfolio; others by visibility. */
export function canSeePortfolio(
  p: {
    studentUserId: string | null;
    organizationId: string;
    visibility: string;
  },
  v: PortfolioViewer,
): boolean {
  if (p.studentUserId === v.id) return true;
  if (v.isGuardian) return true;
  if (v.role === 'SUPER_ADMIN' || v.role === 'SUPERINTENDENT') return true;
  const sameSchool = v.organizationId === p.organizationId;
  if (
    sameSchool &&
    (v.role === 'PRINCIPAL' || v.role === 'COUNSELOR' || v.teaches)
  )
    return true;
  switch (p.visibility as PortfolioVisibility) {
    case 'public':
      return true;
    case 'school':
      return sameSchool;
    default:
      return false;
  }
}

export function isValidSlug(slug: string): boolean {
  return (
    /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(slug) &&
    !['admin', 'api', 'www', 'login'].includes(slug)
  );
}

export function slugFor(
  firstName: string,
  lastName: string,
  suffix: string,
): string {
  const base = `${firstName}-${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  return `${base || 'student'}-${suffix}`;
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export const SKILL_LEVELS = {
  1: 'emerging',
  2: 'developing',
  3: 'proficient',
  4: 'advanced',
} as const;
export const SKILL_CATEGORIES = [
  'communication',
  'collaboration',
  'thinking',
  'technology',
  'creativity',
  'leadership',
  'wellbeing',
] as const;

/** The platform skill catalogue seeded for every school. */
export const PLATFORM_SKILLS: Array<{
  name: string;
  category: (typeof SKILL_CATEGORIES)[number];
  description: string;
}> = [
  {
    name: 'Public speaking',
    category: 'communication',
    description: 'Presents ideas clearly to a group.',
  },
  {
    name: 'Writing',
    category: 'communication',
    description: 'Writes clearly for a purpose and an audience.',
  },
  {
    name: 'Active listening',
    category: 'communication',
    description: 'Hears others out and builds on what they say.',
  },
  {
    name: 'Teamwork',
    category: 'collaboration',
    description: 'Shares work fairly and keeps commitments.',
  },
  {
    name: 'Peer feedback',
    category: 'collaboration',
    description: 'Gives useful, kind feedback.',
  },
  {
    name: 'Problem solving',
    category: 'thinking',
    description: 'Breaks a problem into steps and tests ideas.',
  },
  {
    name: 'Research',
    category: 'thinking',
    description: 'Finds, checks and cites sources.',
  },
  {
    name: 'Data analysis',
    category: 'thinking',
    description: 'Reads charts and tables and draws fair conclusions.',
  },
  {
    name: 'Coding',
    category: 'technology',
    description: 'Writes and debugs small programs.',
  },
  {
    name: 'Digital design',
    category: 'technology',
    description: 'Makes clear slides, pages or graphics.',
  },
  {
    name: 'Spreadsheets',
    category: 'technology',
    description: 'Organises and calculates with spreadsheets.',
  },
  {
    name: 'Creative writing',
    category: 'creativity',
    description: 'Writes stories, poems or scripts.',
  },
  {
    name: 'Visual art',
    category: 'creativity',
    description: 'Draws, paints, photographs or models.',
  },
  {
    name: 'Music',
    category: 'creativity',
    description: 'Performs or composes.',
  },
  {
    name: 'Leading a group',
    category: 'leadership',
    description: 'Organises people toward a goal.',
  },
  {
    name: 'Mentoring',
    category: 'leadership',
    description: 'Helps younger or newer students learn.',
  },
  {
    name: 'Time management',
    category: 'wellbeing',
    description: 'Plans work and meets deadlines.',
  },
  {
    name: 'Perseverance',
    category: 'wellbeing',
    description: 'Keeps going when work gets hard.',
  },
];

// ---------------------------------------------------------------------------
// Interest inventory (Holland codes) and career clusters
// ---------------------------------------------------------------------------

export const RIASEC = ['R', 'I', 'A', 'S', 'E', 'C'] as const;
export type Riasec = (typeof RIASEC)[number];
export const RIASEC_NAMES: Record<Riasec, string> = {
  R: 'Realistic (doing)',
  I: 'Investigative (thinking)',
  A: 'Artistic (creating)',
  S: 'Social (helping)',
  E: 'Enterprising (persuading)',
  C: 'Conventional (organising)',
};

/** Eighteen statements, three per code, answered 1 (not me) to 5 (very much me). */
export const INVENTORY: Array<{ id: string; code: Riasec; text: string }> = [
  {
    id: 'r1',
    code: 'R',
    text: 'I like building or fixing things with my hands.',
  },
  {
    id: 'r2',
    code: 'R',
    text: 'I enjoy working outdoors or with tools and machines.',
  },
  { id: 'r3', code: 'R', text: 'I would rather do a task than read about it.' },
  { id: 'i1', code: 'I', text: 'I like figuring out why things happen.' },
  {
    id: 'i2',
    code: 'I',
    text: 'I enjoy science experiments and math puzzles.',
  },
  { id: 'i3', code: 'I', text: 'I ask a lot of questions and look things up.' },
  { id: 'a1', code: 'A', text: 'I like drawing, writing, music or acting.' },
  {
    id: 'a2',
    code: 'A',
    text: 'I prefer open-ended tasks with room for my own ideas.',
  },
  { id: 'a3', code: 'A', text: 'I notice design, colour and style.' },
  { id: 's1', code: 'S', text: 'I like helping people learn or feel better.' },
  { id: 's2', code: 'S', text: 'Friends come to me when they need advice.' },
  {
    id: 's3',
    code: 'S',
    text: 'I enjoy group projects more than working alone.',
  },
  { id: 'e1', code: 'E', text: 'I like leading a team or running an event.' },
  { id: 'e2', code: 'E', text: 'I enjoy convincing people of my ideas.' },
  { id: 'e3', code: 'E', text: 'I would like to start a business one day.' },
  {
    id: 'c1',
    code: 'C',
    text: 'I like keeping things organised and accurate.',
  },
  {
    id: 'c2',
    code: 'C',
    text: 'I enjoy working with numbers, lists and records.',
  },
  { id: 'c3', code: 'C', text: 'I prefer clear instructions and a plan.' },
];

export interface InventoryResult {
  scores: Record<Riasec, number>;
  /** Top three codes, strongest first; ties broken by the RIASEC order. */
  top: Riasec[];
  code: string;
}

export function scoreInventory(
  answers: Record<string, number>,
): InventoryResult {
  const scores: Record<Riasec, number> = { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 };
  let answered = 0;
  for (const q of INVENTORY) {
    const a = answers[q.id];
    if (typeof a !== 'number' || a < 1 || a > 5) continue;
    scores[q.code] += a;
    answered += 1;
  }
  if (answered < INVENTORY.length)
    throw new RangeError(
      `Answer every statement (${answered} of ${INVENTORY.length} answered).`,
    );
  const top = [...RIASEC]
    .sort(
      (a, b) => scores[b] - scores[a] || RIASEC.indexOf(a) - RIASEC.indexOf(b),
    )
    .slice(0, 3);
  return { scores, top, code: top.join('') };
}

/** The sixteen national career clusters with the interest codes they lean on. */
export const CAREER_CLUSTERS: Array<{
  id: string;
  name: string;
  codes: Riasec[];
  examples: string[];
}> = [
  {
    id: 'agriculture',
    name: 'Agriculture, Food and Natural Resources',
    codes: ['R', 'I'],
    examples: [
      'Veterinary technician',
      'Environmental scientist',
      'Farm manager',
    ],
  },
  {
    id: 'architecture',
    name: 'Architecture and Construction',
    codes: ['R', 'A'],
    examples: ['Architect', 'Electrician', 'Civil engineer'],
  },
  {
    id: 'arts',
    name: 'Arts, Audio/Video Technology and Communications',
    codes: ['A', 'E'],
    examples: ['Graphic designer', 'Journalist', 'Sound engineer'],
  },
  {
    id: 'business',
    name: 'Business Management and Administration',
    codes: ['E', 'C'],
    examples: [
      'Operations manager',
      'Human resources specialist',
      'Entrepreneur',
    ],
  },
  {
    id: 'education',
    name: 'Education and Training',
    codes: ['S', 'A'],
    examples: ['Teacher', 'School counselor', 'Coach'],
  },
  {
    id: 'finance',
    name: 'Finance',
    codes: ['C', 'E'],
    examples: ['Accountant', 'Financial analyst', 'Loan officer'],
  },
  {
    id: 'government',
    name: 'Government and Public Administration',
    codes: ['E', 'S'],
    examples: ['City planner', 'Policy analyst', 'Diplomat'],
  },
  {
    id: 'health',
    name: 'Health Science',
    codes: ['I', 'S'],
    examples: ['Nurse', 'Physician', 'Physical therapist'],
  },
  {
    id: 'hospitality',
    name: 'Hospitality and Tourism',
    codes: ['E', 'S'],
    examples: ['Chef', 'Event planner', 'Hotel manager'],
  },
  {
    id: 'human-services',
    name: 'Human Services',
    codes: ['S', 'E'],
    examples: ['Social worker', 'Child care director', 'Community organiser'],
  },
  {
    id: 'it',
    name: 'Information Technology',
    codes: ['I', 'C'],
    examples: ['Software developer', 'Network administrator', 'Data analyst'],
  },
  {
    id: 'law',
    name: 'Law, Public Safety, Corrections and Security',
    codes: ['S', 'R'],
    examples: ['Lawyer', 'Firefighter', 'Paralegal'],
  },
  {
    id: 'manufacturing',
    name: 'Manufacturing',
    codes: ['R', 'C'],
    examples: ['Machinist', 'Quality inspector', 'Robotics technician'],
  },
  {
    id: 'marketing',
    name: 'Marketing',
    codes: ['E', 'A'],
    examples: ['Marketing manager', 'Market researcher', 'Brand designer'],
  },
  {
    id: 'stem',
    name: 'Science, Technology, Engineering and Mathematics',
    codes: ['I', 'R'],
    examples: ['Mechanical engineer', 'Research scientist', 'Statistician'],
  },
  {
    id: 'transportation',
    name: 'Transportation, Distribution and Logistics',
    codes: ['R', 'E'],
    examples: ['Pilot', 'Logistics manager', 'Automotive technician'],
  },
];

/** Clusters ranked by how well the student's top codes match; a cluster's first code counts double. */
export function matchClusters(
  top: Riasec[],
  limit = 5,
): Array<{ id: string; name: string; examples: string[]; fit: number }> {
  const weight = (c: Riasec) => {
    const i = top.indexOf(c);
    return i === -1 ? 0 : 3 - i;
  };
  return CAREER_CLUSTERS.map((cl) => ({
    id: cl.id,
    name: cl.name,
    examples: cl.examples,
    fit: cl.codes.reduce((s, c, i) => s + weight(c) * (i === 0 ? 2 : 1), 0),
  }))
    .filter((c) => c.fit > 0)
    .sort((a, b) => b.fit - a.fit || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Readiness checklist
// ---------------------------------------------------------------------------

export interface ChecklistItem {
  key: string;
  label: string;
  /** Lowest grade the item applies from. */
  fromGrade: number;
  who: 'student' | 'counselor';
}

export const READINESS_CHECKLIST: ChecklistItem[] = [
  {
    key: 'interests',
    label: 'Complete the interest inventory',
    fromGrade: 6,
    who: 'student',
  },
  {
    key: 'skills',
    label: 'Add at least three skills to the portfolio',
    fromGrade: 6,
    who: 'student',
  },
  {
    key: 'project',
    label: 'Publish one portfolio project',
    fromGrade: 7,
    who: 'student',
  },
  {
    key: 'pathways',
    label: 'Pick two career pathways to explore',
    fromGrade: 8,
    who: 'student',
  },
  {
    key: 'four-year-plan',
    label: 'Four-year course plan reviewed with the counselor',
    fromGrade: 9,
    who: 'counselor',
  },
  {
    key: 'activities',
    label: 'Join one activity, club or service project',
    fromGrade: 9,
    who: 'student',
  },
  {
    key: 'college-list',
    label: 'Build a first college or training list',
    fromGrade: 10,
    who: 'student',
  },
  {
    key: 'test-plan',
    label: 'Test plan (PSAT, SAT or ACT, or test-optional) agreed',
    fromGrade: 10,
    who: 'counselor',
  },
  {
    key: 'resume',
    label: 'Resume drafted from the portfolio',
    fromGrade: 11,
    who: 'student',
  },
  {
    key: 'recommenders',
    label: 'Two recommenders identified',
    fromGrade: 11,
    who: 'counselor',
  },
  {
    key: 'fafsa',
    label: 'FAFSA or state aid form submitted',
    fromGrade: 12,
    who: 'counselor',
  },
  {
    key: 'applications',
    label: 'Applications submitted',
    fromGrade: 12,
    who: 'student',
  },
  {
    key: 'decision',
    label: 'Decision made and recorded',
    fromGrade: 12,
    who: 'counselor',
  },
];

export function gradeNumber(gradeLevel: string | null): number | null {
  if (!gradeLevel) return null;
  const g = gradeLevel.trim().toUpperCase();
  if (g === 'K' || g === 'KG') return 0;
  const n = Number.parseInt(g, 10);
  return Number.isFinite(n) ? n : null;
}

export interface ChecklistState {
  key: string;
  label: string;
  who: ChecklistItem['who'];
  done: boolean;
  doneAt: string | null;
  byId: string | null;
}

/** The items that apply to the student's grade, merged with what has been ticked. */
export function checklistFor(
  gradeLevel: string | null,
  stored: Array<{ key: string; doneAt: string; byId: string | null }>,
): ChecklistState[] {
  const grade = gradeNumber(gradeLevel) ?? 12;
  const map = new Map(stored.map((s) => [s.key, s]));
  return READINESS_CHECKLIST.filter((i) => i.fromGrade <= grade).map((i) => {
    const s = map.get(i.key);
    return {
      key: i.key,
      label: i.label,
      who: i.who,
      done: !!s,
      doneAt: s?.doneAt ?? null,
      byId: s?.byId ?? null,
    };
  });
}

export function readinessPercent(items: ChecklistState[]): number {
  return items.length
    ? Math.round((items.filter((i) => i.done).length / items.length) * 100)
    : 0;
}

export const COLLEGE_PLAN_STATUSES = [
  'interested',
  'applied',
  'accepted',
  'enrolled',
  'declined',
] as const;

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

export interface ResumeInput {
  student: {
    firstName: string;
    lastName: string;
    gradeLevel: string | null;
    email: string | null;
  };
  school: { name: string; address: string | null };
  headline: string | null;
  about: string | null;
  projects: Array<{
    title: string;
    summary: string | null;
    kind: string;
    completedOn: Date | null;
    skills: string[];
  }>;
  skills: Array<{ name: string; level: number; endorsements: number }>;
  badges: Array<{ name: string; awardedAt: Date }>;
  courses: Array<{ title: string; year: string; letter: string | null }>;
  pathways: string[];
}

export interface ResumeSection {
  title: string;
  lines: string[];
}

/** Resume content, in the order it prints; empty sections are left out. */
export function resumeSections(r: ResumeInput): ResumeSection[] {
  const sections: ResumeSection[] = [];
  if (r.headline || r.about)
    sections.push({
      title: 'Profile',
      lines: [r.headline, r.about].filter((x): x is string => !!x),
    });
  sections.push({
    title: 'Education',
    lines: [
      `${r.school.name}${r.student.gradeLevel ? `, grade ${r.student.gradeLevel}` : ''}`,
      ...(r.school.address ? [r.school.address] : []),
    ],
  });
  if (r.courses.length)
    sections.push({
      title: 'Courses',
      lines: r.courses.map(
        (c) => `${c.title} (${c.year})${c.letter ? `: ${c.letter}` : ''}`,
      ),
    });
  if (r.projects.length)
    sections.push({
      title: 'Projects',
      lines: r.projects.map(
        (p) =>
          `${p.title}${p.completedOn ? ` (${p.completedOn.getFullYear()})` : ''}${p.summary ? `: ${p.summary}` : ''}${p.skills.length ? ` [${p.skills.join(', ')}]` : ''}`,
      ),
    });
  if (r.skills.length)
    sections.push({
      title: 'Skills',
      lines: r.skills.map(
        (s) =>
          `${s.name}: ${SKILL_LEVELS[s.level as 1 | 2 | 3 | 4] ?? 'emerging'}${s.endorsements ? ` (${s.endorsements} endorsement${s.endorsements === 1 ? '' : 's'})` : ''}`,
      ),
    });
  if (r.badges.length)
    sections.push({
      title: 'Recognition',
      lines: r.badges.map((b) => `${b.name} (${b.awardedAt.getFullYear()})`),
    });
  if (r.pathways.length)
    sections.push({ title: 'Career interests', lines: r.pathways });
  return sections;
}

// ---------------------------------------------------------------------------
// Code lessons
// ---------------------------------------------------------------------------

export interface CodeTest {
  /** An expression evaluated after the student's code, for example "add(2, 3)". */
  expr: string;
  /** JSON text of the expected value. */
  expected: string;
  label?: string;
}

export interface TestOutcome {
  label: string;
  passed: boolean;
  expected: string;
  got: string;
}

/** Equal when the JSON forms match; numbers compare within a small tolerance. */
export function compareResult(expected: string, got: unknown): boolean {
  let exp: unknown;
  try {
    exp = JSON.parse(expected);
  } catch {
    exp = expected;
  }
  if (typeof exp === 'number' && typeof got === 'number')
    return Math.abs(exp - got) < 1e-9;
  return JSON.stringify(exp) === JSON.stringify(got);
}

export function summarizeRun(
  outcomes: TestOutcome[],
  error: string | null,
): { status: 'passed' | 'failed' | 'error'; passed: number; total: number } {
  const passed = outcomes.filter((o) => o.passed).length;
  if (error) return { status: 'error', passed, total: outcomes.length };
  return {
    status:
      passed === outcomes.length && outcomes.length > 0 ? 'passed' : 'failed',
    passed,
    total: outcomes.length,
  };
}

export const CODE_LIMITS = {
  timeoutMs: 2000,
  memoryMb: 64,
  sourceMaxChars: 20_000,
  outputMaxChars: 4000,
} as const;

/** The platform code lessons seeded for every school. */
export const PLATFORM_CODE_LESSONS: Array<{
  title: string;
  description: string;
  level: number;
  starter: string;
  tests: CodeTest[];
}> = [
  {
    title: 'Add two numbers',
    description: 'Write a function add(a, b) that returns the sum of a and b.',
    level: 1,
    starter: 'function add(a, b) {\n  // your code here\n}\n',
    tests: [
      { expr: 'add(2, 3)', expected: '5' },
      { expr: 'add(-1, 1)', expected: '0' },
      { expr: 'add(0.5, 0.25)', expected: '0.75' },
    ],
  },
  {
    title: 'Is it even?',
    description:
      'Write isEven(n) that returns true when n is even and false otherwise.',
    level: 1,
    starter: 'function isEven(n) {\n  // your code here\n}\n',
    tests: [
      { expr: 'isEven(4)', expected: 'true' },
      { expr: 'isEven(7)', expected: 'false' },
      { expr: 'isEven(0)', expected: 'true' },
    ],
  },
  {
    title: 'Count the vowels',
    description:
      'Write countVowels(text) that returns how many of a, e, i, o, u appear in text (any case).',
    level: 2,
    starter: 'function countVowels(text) {\n  // your code here\n}\n',
    tests: [
      { expr: 'countVowels("hello")', expected: '2' },
      { expr: 'countVowels("SKY")', expected: '0' },
      { expr: 'countVowels("Education")', expected: '5' },
    ],
  },
  {
    title: 'Biggest in the list',
    description:
      'Write largest(numbers) that returns the largest number in a non-empty array.',
    level: 2,
    starter: 'function largest(numbers) {\n  // your code here\n}\n',
    tests: [
      { expr: 'largest([3, 9, 2])', expected: '9' },
      { expr: 'largest([-5, -2, -8])', expected: '-2' },
      { expr: 'largest([7])', expected: '7' },
    ],
  },
  {
    title: 'FizzBuzz line',
    description:
      'Write fizzbuzz(n) that returns "Fizz" for multiples of 3, "Buzz" for multiples of 5, "FizzBuzz" for both, and the number as a string otherwise.',
    level: 3,
    starter: 'function fizzbuzz(n) {\n  // your code here\n}\n',
    tests: [
      { expr: 'fizzbuzz(3)', expected: '"Fizz"' },
      { expr: 'fizzbuzz(10)', expected: '"Buzz"' },
      { expr: 'fizzbuzz(15)', expected: '"FizzBuzz"' },
      { expr: 'fizzbuzz(7)', expected: '"7"' },
    ],
  },
  {
    title: 'Reverse the words',
    description:
      'Write reverseWords(sentence) that returns the words in reverse order, separated by single spaces.',
    level: 3,
    starter: 'function reverseWords(sentence) {\n  // your code here\n}\n',
    tests: [
      {
        expr: 'reverseWords("the quick brown fox")',
        expected: '"fox brown quick the"',
      },
      { expr: 'reverseWords("one")', expected: '"one"' },
    ],
  },
];
