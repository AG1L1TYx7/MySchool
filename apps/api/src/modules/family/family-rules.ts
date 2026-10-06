/**
 * Pure rules for the family experience (docs/13 section 7): which work counts as missing, what goes into
 * a weekly digest, and the family-language strings the API itself sends (notifications and emails).
 */

export type Locale = 'en' | 'es';
export const LOCALES: readonly Locale[] = ['en', 'es'];
export const localeOf = (value: string | null | undefined): Locale =>
  value?.toLowerCase().startsWith('es') ? 'es' : 'en';

export interface WorkItem {
  assignmentId: string;
  title: string;
  className: string;
  dueAt: Date | null;
  submitted: boolean;
  graded: boolean;
  mark: 'MISSING' | 'EXCUSED' | 'INCOMPLETE' | null;
}

/** Published work past its due date with nothing turned in and no excuse; teacher marks win. */
export function isMissing(item: WorkItem, now = new Date()): boolean {
  if (item.mark === 'EXCUSED') return false;
  if (item.mark === 'MISSING') return true;
  if (item.submitted || item.graded) return false;
  return !!item.dueAt && item.dueAt.getTime() < now.getTime();
}

/** Due within the next `days` days and not yet turned in. */
export function isUpcoming(
  item: WorkItem,
  now = new Date(),
  days = 7,
): boolean {
  if (item.submitted || item.graded || item.mark === 'EXCUSED') return false;
  if (!item.dueAt) return false;
  const t = item.dueAt.getTime();
  return t >= now.getTime() && t <= now.getTime() + days * 86_400_000;
}

export interface ChildDigest {
  firstName: string;
  classes: Array<{
    name: string;
    percentage: number | null;
    letter: string | null;
  }>;
  attendanceRate: number | null;
  daysAbsent: number;
  missing: Array<{ title: string; className: string }>;
  upcoming: Array<{ title: string; className: string; dueAt: Date | null }>;
  gradedThisWeek: number;
}

const STRINGS = {
  en: {
    digestSubject: (names: string) => `This week at school: ${names}`,
    digestIntro: (first: string) =>
      `Hi ${first}, here is a short summary of the past week for your family.`,
    classes: 'Classes',
    noGrades: 'no grades yet',
    attendance: (rate: number | null, absent: number) =>
      rate === null
        ? 'No attendance recorded this week.'
        : `Attendance: ${rate}% (${absent} day${absent === 1 ? '' : 's'} absent).`,
    missing: (n: number) =>
      n === 0 ? 'No missing work. Nice.' : `Missing work (${n}):`,
    upcoming: (n: number) =>
      n === 0
        ? 'Nothing due in the next seven days.'
        : `Due in the next seven days (${n}):`,
    graded: (n: number) =>
      `${n} assignment${n === 1 ? '' : 's'} graded this week.`,
    footer:
      'Open SmartSchool for the details. You can change which notices reach your inbox under Notifications.',
    missingAlertTitle: (first: string, n: number) =>
      `${first} has ${n} missing assignment${n === 1 ? '' : 's'}`,
    missingAlertBody: (items: string) =>
      `Past due with nothing turned in: ${items}. A quick check-in tonight usually helps.`,
    digestTitle: 'Your weekly family summary is ready',
    digestBody: (names: string) => `A short summary of the week for ${names}.`,
    due: 'due',
  },
  es: {
    digestSubject: (names: string) => `Esta semana en la escuela: ${names}`,
    digestIntro: (first: string) =>
      `Hola ${first}, aquí tiene un breve resumen de la semana pasada para su familia.`,
    classes: 'Clases',
    noGrades: 'todavía sin calificaciones',
    attendance: (rate: number | null, absent: number) =>
      rate === null
        ? 'No se registró asistencia esta semana.'
        : `Asistencia: ${rate}% (${absent} día${absent === 1 ? '' : 's'} de ausencia).`,
    missing: (n: number) =>
      n === 0
        ? 'No hay trabajos pendientes. ¡Muy bien!'
        : `Trabajos sin entregar (${n}):`,
    upcoming: (n: number) =>
      n === 0
        ? 'Nada por entregar en los próximos siete días.'
        : `Por entregar en los próximos siete días (${n}):`,
    graded: (n: number) =>
      `${n} tarea${n === 1 ? '' : 's'} calificada${n === 1 ? '' : 's'} esta semana.`,
    footer:
      'Abra SmartSchool para ver los detalles. Puede cambiar qué avisos llegan a su correo en Notificaciones.',
    missingAlertTitle: (first: string, n: number) =>
      `${first} tiene ${n} tarea${n === 1 ? '' : 's'} sin entregar`,
    missingAlertBody: (items: string) =>
      `Vencidas y sin entregar: ${items}. Una conversación breve esta noche suele ayudar.`,
    digestTitle: 'Su resumen semanal familiar está listo',
    digestBody: (names: string) => `Un breve resumen de la semana de ${names}.`,
    due: 'vence',
  },
} as const;

export function strings(locale: Locale) {
  return STRINGS[locale];
}

/** The plain-text weekly email for one guardian; every number comes from the digest inputs. */
export function renderDigest(
  locale: Locale,
  guardianFirstName: string,
  children: ChildDigest[],
): { subject: string; text: string } {
  const t = strings(locale);
  const names = children
    .map((c) => c.firstName)
    .join(locale === 'es' ? ' y ' : ' and ');
  const fmt = (d: Date | null) =>
    d
      ? d.toLocaleDateString(locale === 'es' ? 'es-US' : 'en-US', {
          month: 'short',
          day: 'numeric',
        })
      : '';
  const lines: string[] = [t.digestIntro(guardianFirstName), ''];
  for (const c of children) {
    lines.push(`== ${c.firstName} ==`);
    lines.push(
      `${t.classes}: ${c.classes.map((k) => `${k.name} ${k.percentage === null ? t.noGrades : `${k.percentage}% ${k.letter ?? ''}`.trim()}`).join('; ') || t.noGrades}`,
    );
    lines.push(t.attendance(c.attendanceRate, c.daysAbsent));
    lines.push(t.graded(c.gradedThisWeek));
    lines.push(t.missing(c.missing.length));
    for (const m of c.missing) lines.push(`  - ${m.title} (${m.className})`);
    lines.push(t.upcoming(c.upcoming.length));
    for (const u of c.upcoming)
      lines.push(`  - ${u.title} (${u.className}) ${t.due} ${fmt(u.dueAt)}`);
    lines.push('');
  }
  lines.push(t.footer);
  return { subject: t.digestSubject(names), text: lines.join('\n') };
}
