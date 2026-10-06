import { createHmac, timingSafeEqual } from 'node:crypto';
import { FilterXSS } from 'xss';
import {
  CONTENT_TYPES,
  findLibrary,
  QUESTION_SET_CHILDREN,
  type LibraryDefinition,
} from './h5p-libraries';

/** Pure rules for interactive content: library strings, parameter validation, scores, manifests, play tickets. */

export interface LibraryRef {
  machineName: string;
  majorVersion: number;
  minorVersion: number;
}

/** Parses "H5P.QuestionSet 1.20" into its parts; null when malformed or not a library we serve. */
export function parseLibrary(value: string): LibraryRef | null {
  const m = /^([A-Za-z][\w.]*)\s+(\d+)\.(\d+)$/.exec(value.trim());
  if (!m) return null;
  const def = findLibrary(m[1]);
  if (!def || def.major !== Number(m[2]) || def.minor !== Number(m[3]))
    return null;
  return {
    machineName: m[1],
    majorVersion: Number(m[2]),
    minorVersion: Number(m[3]),
  };
}

export function contentTypeFor(library: string): string {
  const name = library.split(' ')[0];
  const entry = Object.entries(CONTENT_TYPES).find(
    ([, v]) => v.library.split(' ')[0] === name,
  );
  return entry ? entry[0] : name.replace(/^H5P\./, '').toLowerCase();
}

type Params = Record<string, unknown>;

const isRecord = (v: unknown): v is Params =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Structural validation mirroring the AI service's `h5p.validate`: what the player would trip over. */
/**
 * H5P libraries render parameter strings as HTML, so anything a teacher (or the AI) types is markup a student's
 * browser will run. Keep formatting, drop scripts, frames, styles, event handlers and javascript: links.
 */
const ATTRS = ['class'];
const TAGS = [
  'p',
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'sub',
  'sup',
  'span',
  'div',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'code',
  'pre',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
];
const filter = new FilterXSS({
  whiteList: {
    ...Object.fromEntries(TAGS.map((t) => [t, ATTRS])),
    a: ['href', 'title', 'target', 'rel', 'class'],
    img: ['src', 'alt', 'title', 'width', 'height', 'class'],
  },
  stripIgnoreTag: true,
  stripIgnoreTagBody: [
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'noscript',
  ],
});

/** Every string anywhere in the parameters, cleaned; everything else left as it is. */
export function sanitizeParameters<T>(value: T): T {
  if (typeof value === 'string') return filter.process(value) as unknown as T;
  if (Array.isArray(value))
    return (value as unknown[]).map((v) =>
      sanitizeParameters(v),
    ) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      out[k] = sanitizeParameters(v);
    return out as T;
  }
  return value;
}

export function validateParameters(library: string, params: unknown): string[] {
  const ref = parseLibrary(library);
  if (!ref) return [`unsupported library ${library}`];
  if (!isRecord(params)) return ['parameters must be an object'];
  const errors: string[] = [];
  switch (ref.machineName) {
    case 'H5P.QuestionSet': {
      const questions = params.questions;
      if (!Array.isArray(questions) || questions.length === 0)
        return ['questions must be a non-empty list'];
      questions.forEach((q, i) => {
        if (
          !isRecord(q) ||
          typeof q.library !== 'string' ||
          !isRecord(q.params)
        ) {
          errors.push(`question ${i + 1}: needs library and params`);
          return;
        }
        for (const e of validateParameters(q.library, q.params))
          errors.push(`question ${i + 1}: ${e}`);
      });
      break;
    }
    case 'H5P.MultiChoice': {
      const answers = params.answers;
      if (!params.question) errors.push('question text is required');
      if (!Array.isArray(answers) || answers.length < 2)
        errors.push('at least two answers are required');
      else if (!answers.some((a) => isRecord(a) && a.correct === true))
        errors.push('one answer must be marked correct');
      break;
    }
    case 'H5P.TrueFalse':
      if (!params.question) errors.push('question text is required');
      if (params.correct !== 'true' && params.correct !== 'false')
        errors.push("correct must be 'true' or 'false'");
      break;
    case 'H5P.Blanks': {
      const qs = params.questions;
      if (!Array.isArray(qs) || qs.length === 0)
        errors.push('questions must be a non-empty list');
      else if (
        !qs.every(
          (t) => typeof t === 'string' && (t.match(/\*/g) ?? []).length >= 2,
        )
      )
        errors.push('each blank must be marked with *answer*');
      break;
    }
    case 'H5P.Dialogcards': {
      const dialogs = params.dialogs;
      if (!Array.isArray(dialogs) || dialogs.length === 0)
        errors.push('dialogs must be a non-empty list');
      else
        dialogs.forEach(
          (d, i) =>
            (!isRecord(d) || !d.text || !d.answer) &&
            errors.push(`card ${i + 1}: text and answer are required`),
        );
      break;
    }
    default:
      errors.push(`${ref.machineName} cannot be created here`);
  }
  return errors;
}

/** Points the content awards when fully correct (one per question or card). */
export function maxScoreOf(library: string, params: unknown): number {
  const ref = parseLibrary(library);
  if (!ref || !isRecord(params)) return 0;
  if (ref.machineName === 'H5P.QuestionSet')
    return Array.isArray(params.questions) ? params.questions.length : 0;
  if (ref.machineName === 'H5P.Dialogcards')
    return Array.isArray(params.dialogs) ? params.dialogs.length : 0;
  return 1;
}

/** Transitive dependencies of a main library, in load order, including the library itself last. */
export function dependenciesFor(machineName: string): LibraryDefinition[] {
  const out: LibraryDefinition[] = [];
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const def = findLibrary(name);
    if (!def) return;
    for (const dep of def.dependencies) visit(dep);
    out.push(def);
  };
  visit(machineName);
  if (machineName === 'H5P.QuestionSet')
    for (const child of QUESTION_SET_CHILDREN) visit(child);
  return out;
}

/** The h5p.json the standalone player reads. */
export function buildManifest(
  title: string,
  library: string,
): Record<string, unknown> {
  const ref = parseLibrary(library);
  if (!ref) throw new Error(`unsupported library ${library}`);
  return {
    title,
    language: 'en',
    defaultLanguage: 'en',
    mainLibrary: ref.machineName,
    embedTypes: ['div'],
    license: 'U',
    preloadedDependencies: dependenciesFor(ref.machineName).map((d) => ({
      machineName: d.machineName,
      majorVersion: String(d.major),
      minorVersion: String(d.minor),
    })),
  };
}

// ---------------------------------------------------------------------------
// Play tickets: the player fetches h5p.json and content.json without our bearer token, so the
// authorised call to /play mints a short-lived signed ticket bound to the content and the user.
// ---------------------------------------------------------------------------

export interface PlayTicket {
  contentId: string;
  userId: string;
  assignmentId: string | null;
  exp: number;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');

export function signPlayTicket(ticket: PlayTicket, secret: string): string {
  const payload = b64(JSON.stringify(ticket));
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyPlayTicket(
  token: string,
  secret: string,
  now = Date.now(),
): PlayTicket | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig || token.length > 600) return null;
  const expected = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  if (
    expected.length !== sig.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  )
    return null;
  try {
    const ticket = JSON.parse(
      Buffer.from(payload, 'base64url').toString(),
    ) as PlayTicket;
    if (
      typeof ticket.contentId !== 'string' ||
      typeof ticket.userId !== 'string' ||
      typeof ticket.exp !== 'number'
    )
      return null;
    if (ticket.exp * 1000 < now) return null;
    return ticket;
  } catch {
    return null;
  }
}

/** Scales a player score onto an assignment's points, to two decimals. */
export function scaledScore(
  score: number,
  maxScore: number,
  maxPoints: number,
): number {
  if (maxScore <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, score / maxScore));
  return Math.round((ratio * maxPoints + Number.EPSILON) * 100) / 100;
}
