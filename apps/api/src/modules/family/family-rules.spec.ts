import {
  isMissing,
  isUpcoming,
  localeOf,
  renderDigest,
  type WorkItem,
} from './family-rules';

const now = new Date('2026-10-05T12:00:00Z');
const item = (over: Partial<WorkItem>): WorkItem => ({
  assignmentId: 'a',
  title: 'Essay',
  className: 'ELA',
  dueAt: new Date('2026-10-01T00:00:00Z'),
  submitted: false,
  graded: false,
  mark: null,
  ...over,
});

describe('family rules', () => {
  it('decides what is missing and what is coming up', () => {
    expect(isMissing(item({}), now)).toBe(true);
    expect(isMissing(item({ submitted: true }), now)).toBe(false);
    expect(isMissing(item({ mark: 'EXCUSED' }), now)).toBe(false);
    expect(isMissing(item({ mark: 'MISSING', submitted: true }), now)).toBe(
      true,
    );
    expect(isMissing(item({ dueAt: null }), now)).toBe(false);
    expect(
      isMissing(item({ dueAt: new Date('2026-10-09T00:00:00Z') }), now),
    ).toBe(false);
    expect(
      isUpcoming(item({ dueAt: new Date('2026-10-09T00:00:00Z') }), now),
    ).toBe(true);
    expect(
      isUpcoming(item({ dueAt: new Date('2026-10-20T00:00:00Z') }), now),
    ).toBe(false);
    expect(
      isUpcoming(
        item({ dueAt: new Date('2026-10-09T00:00:00Z'), submitted: true }),
        now,
      ),
    ).toBe(false);
  });

  it('maps locales and renders the digest in Spanish', () => {
    expect(localeOf('es-MX')).toBe('es');
    expect(localeOf('en')).toBe('en');
    expect(localeOf(null)).toBe('en');
    const out = renderDigest('es', 'Michael', [
      {
        firstName: 'Emma',
        classes: [{ name: 'ELA 7', percentage: 91.5, letter: 'A' }],
        attendanceRate: 80,
        daysAbsent: 1,
        missing: [{ title: 'Essay', className: 'ELA 7' }],
        upcoming: [
          {
            title: 'Quiz',
            className: 'ELA 7',
            dueAt: new Date('2026-10-08T00:00:00Z'),
          },
        ],
        gradedThisWeek: 2,
      },
    ]);
    expect(out.subject).toBe('Esta semana en la escuela: Emma');
    expect(out.text).toContain('Hola Michael');
    expect(out.text).toContain('ELA 7 91.5% A');
    expect(out.text).toContain('Asistencia: 80% (1 día de ausencia).');
    expect(out.text).toContain('Trabajos sin entregar (1):');
    expect(out.text).toContain('- Essay (ELA 7)');
    expect(out.text).toContain('2 tareas calificadas esta semana.');
    const en = renderDigest('en', 'Michael', [
      {
        firstName: 'Emma',
        classes: [],
        attendanceRate: null,
        daysAbsent: 0,
        missing: [],
        upcoming: [],
        gradedThisWeek: 0,
      },
    ]);
    expect(en.text).toContain('No missing work. Nice.');
    expect(en.text).toContain('No attendance recorded this week.');
  });
});
