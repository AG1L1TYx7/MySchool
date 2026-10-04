/**
 * Pure rules for support and safety (docs/13 sections 6 and 10): who may see a behaviour record, whether a
 * student needs AI consent and has it, and how extended time stretches an assignment window.
 */

export type BehaviorVisibility = 'ALL' | 'POSITIVE_ONLY' | 'NONE';
export const BEHAVIOR_VISIBILITIES: readonly BehaviorVisibility[] = [
  'ALL',
  'POSITIVE_ONLY',
  'NONE',
];
export type AiConsentDefault = 'SCHOOL' | 'PARENT';
export const AI_CONSENT_DEFAULTS: readonly AiConsentDefault[] = [
  'SCHOOL',
  'PARENT',
];

/** COPPA: under 13 on the day in question. Unknown birth dates are treated as under 13 to stay on the safe side. */
export function isUnder13(dateOfBirth: Date | null, now = new Date()): boolean {
  if (!dateOfBirth) return true;
  const years = (now.getTime() - dateOfBirth.getTime()) / (365.25 * 86_400_000);
  return years < 13;
}

/**
 * Whether a student may use AI features. Students 13 and over always may. Under 13: a parent's decision
 * wins when recorded; otherwise the school's default applies (SCHOOL consents on the parents' behalf,
 * PARENT means a parent must grant it first).
 */
export function aiAllowed(input: {
  dateOfBirth: Date | null;
  schoolDefault: string;
  consent: 'GRANTED' | 'DECLINED' | 'PENDING' | null;
  now?: Date;
}): {
  allowed: boolean;
  reason:
    | 'adult'
    | 'parent_granted'
    | 'parent_declined'
    | 'school_default'
    | 'parent_required';
} {
  if (!isUnder13(input.dateOfBirth, input.now))
    return { allowed: true, reason: 'adult' };
  if (input.consent === 'GRANTED')
    return { allowed: true, reason: 'parent_granted' };
  if (input.consent === 'DECLINED')
    return { allowed: false, reason: 'parent_declined' };
  if (input.schoolDefault === 'SCHOOL')
    return { allowed: true, reason: 'school_default' };
  return { allowed: false, reason: 'parent_required' };
}

/** A parent (or student) may see a record when the school's rule allows it or the record was marked visible. */
export function behaviorVisibleToFamily(
  record: {
    kind: 'POSITIVE' | 'CONCERN' | 'INCIDENT';
    parentVisible: boolean | null;
  },
  rule: string,
): boolean {
  if (record.parentVisible !== null) return record.parentVisible;
  if (rule === 'ALL') return true;
  if (rule === 'POSITIVE_ONLY') return record.kind === 'POSITIVE';
  return false;
}

/**
 * Extended time stretches the window from when work opened to when it is due by the given percent; the
 * late window moves by the same amount. With no due date nothing changes.
 */
export function extendWindow(
  input: {
    availableFrom: Date | null;
    publishedAt: Date | null;
    createdAt: Date;
    dueAt: Date | null;
    allowLateUntil: Date | null;
  },
  extendedTimePercent: number,
): { dueAt: Date | null; allowLateUntil: Date | null; extraMs: number } {
  if (!input.dueAt || extendedTimePercent <= 0)
    return {
      dueAt: input.dueAt,
      allowLateUntil: input.allowLateUntil,
      extraMs: 0,
    };
  const opened = input.availableFrom ?? input.publishedAt ?? input.createdAt;
  const span = Math.max(0, input.dueAt.getTime() - opened.getTime());
  const extraMs = Math.round((span * extendedTimePercent) / 100);
  return {
    dueAt: new Date(input.dueAt.getTime() + extraMs),
    allowLateUntil: input.allowLateUntil
      ? new Date(input.allowLateUntil.getTime() + extraMs)
      : null,
    extraMs,
  };
}

/** The excerpt kept with a wellness alert: enough for a counselor to act, never the whole conversation. */
export function excerptFor(text: string, max = 400): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}
