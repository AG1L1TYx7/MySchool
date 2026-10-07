'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MotionItem, MotionList, PillGroup, ProgressRing, SkeletonRows } from '@/components/motion';
import { TranscriptButton } from '@/components/insight-cards';
import { FamilyRecordsCard } from '@/components/records-card';
import { FamilyLearningCard } from '@/components/learning-cards';
import { FamilyMotivationCard } from '@/components/motivation-cards';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Button, Card } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { ChildHome } from '@/lib/family';
import { useI18n } from '@/lib/i18n';

const CHILD_KEY = 'ss_child';

/**
 * The family home (docs/13 section 7): one place per child with the current grade in every class,
 * attendance, missing and upcoming work, this week's grades, and a preview of the weekly digest email.
 */
export default function FamilyPage() {
  const { can } = useAuth();
  const { t, n, tag } = useI18n();
  const [children, setChildren] = useState<ChildHome[] | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const allowed = can('family.view');

  useEffect(() => {
    if (!allowed) return;
    api<{ children: ChildHome[] }>('/family/home')
      .then((r) => {
        setChildren(r.children);
        let remembered: string | null = null;
        try {
          remembered = localStorage.getItem(CHILD_KEY);
        } catch {
          /* ignore */
        }
        const first = r.children.find((c) => c.student.id === remembered) ?? r.children[0];
        setSelected(first?.student.id ?? '');
      })
      .catch((err) => setError(errorMessage(err)));
  }, [allowed]);

  function pick(id: string) {
    setSelected(id);
    try {
      localStorage.setItem(CHILD_KEY, id);
    } catch {
      /* ignore */
    }
  }

  if (!allowed) return <NotForYou what={t('fam.title')} back="/dashboard" />;
  const child = children?.find((c) => c.student.id === selected) ?? null;
  const ids = (children ?? []).map((c) => c.student.id);
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(tag, { month: 'short', day: 'numeric' }) : '');

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('fam.title')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('fam.subtitle')}</p>
        </div>
        {children && children.length > 1 && <PillGroup name={t('fam.child')} options={ids} value={selected} onChange={pick} labels={(id) => children.find((c) => c.student.id === id)?.student.firstName ?? id} />}
      </div>
      {error && <Alert>{error}</Alert>}
      {children === null && !error && <SkeletonRows rows={4} />}
      {children && children.length === 0 && <p className="text-sm text-slate-500">{t('fam.noChildren')}</p>}
      {child && <Child child={child} fmt={fmt} />}
      {children && children.length > 0 && <Digest />}
    </div>
  );

  function Child({ child, fmt }: { child: ChildHome; fmt: (iso: string | null) => string }) {
    const s = child.student;
    const a = child.attendance;
    const average = child.classes.filter((c) => c.percentage !== null);
    const avg = average.length ? average.reduce((sum, c) => sum + (c.percentage ?? 0), 0) / average.length : null;
    return (
      <>
        <Card title={`${s.firstName} ${s.lastName}`} description={[s.gradeLevel ? t('fam.gradeLevel', { grade: s.gradeLevel }) : null, s.studentNumber].filter(Boolean).join(' · ')} actions={<Link href="/grades" className="text-sm text-brand-700 hover:underline">{t('fam.seeGrades')}</Link>}>
          <div className="flex flex-wrap items-start gap-8">
            {a.rate !== null && <ProgressRing value={a.rate} size={88} stroke={9} label={t('fam.attendance')} tone={a.rate >= 90 ? 'green' : a.rate >= 80 ? 'brand' : 'amber'} />}
            {avg !== null && <ProgressRing value={avg} size={88} stroke={9} label={t('grades.average')} tone={avg >= 90 ? 'green' : avg >= 60 ? 'brand' : 'amber'} />}
            <div className="min-w-[220px] flex-1 space-y-1 text-sm text-slate-700">
              <p>{a.rate === null ? t('fam.noAttendance') : t('fam.attendanceDesc', { present: a.daysPresent, absent: a.daysAbsent, tardies: a.tardies })}</p>
              <p>
                <Link href="/grades" className="text-brand-700 hover:underline">
                  {n('fam.behaviour', child.behaviorNotes)}
                </Link>
                {' · '}
                <Link href="/report-cards" className="text-brand-700 hover:underline">
                  {n('fam.reportCards', child.reportCards)}
                </Link>
              </p>
              <p>
                <Link href="/messages" className="text-brand-700 hover:underline">
                  {t('fam.message')}
                </Link>
              </p>
            </div>
          </div>
        </Card>

        <FamilyMotivationCard studentId={s.id} firstName={s.firstName} />
        <FamilyLearningCard studentId={s.id} firstName={s.firstName} />
        <Card title={t('fam.transcript')} description={t('fam.transcriptDesc')}>
          <TranscriptButton studentId={s.id} lastName={s.lastName} />
        </Card>
        <FamilyRecordsCard studentId={s.id} lastName={s.lastName} />

        <Card title={t('fam.classes')} description={t('fam.classesDesc')}>
          <MotionList className="divide-y divide-slate-100">
            {child.classes.map((c) => (
              <MotionItem key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <Link href={`/classes/${c.id}`} className="font-medium text-slate-900 hover:underline">
                    {c.name}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {c.courseTitle}
                    {c.teacher ? ` · ${t('fam.teacher')}: ${c.teacher}` : ''}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${c.percentage === null ? 'bg-slate-100 text-slate-600' : c.percentage >= 90 ? 'bg-green-50 text-green-800' : c.percentage >= 60 ? 'bg-brand-50 text-brand-800' : 'bg-amber-50 text-amber-900'}`}>{c.percentage === null ? t('fam.noGrade') : `${c.percentage}%${c.letter ? ` ${c.letter}` : ''}`}</span>
              </MotionItem>
            ))}
          </MotionList>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <Card title={t('fam.missing')} description={child.missing.length ? t('fam.missingDesc') : t('fam.noMissing')}>
            <WorkList items={child.missing} fmt={fmt} tone="amber" />
          </Card>
          <Card title={t('fam.upcoming')} description={child.upcoming.length ? undefined : t('fam.noUpcoming')}>
            <WorkList items={child.upcoming} fmt={fmt} tone="brand" />
          </Card>
        </div>

        <Card title={t('fam.recent')} description={child.recentGrades.length ? undefined : t('fam.noRecent')}>
          <ul className="divide-y divide-slate-100 text-sm">
            {child.recentGrades.map((g) => (
              <li key={g.assignmentId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <Link href={`/assignments/${g.assignmentId}`} className="font-medium text-slate-900 hover:underline">
                    {g.title}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {g.className} · {fmt(g.gradedAt)}
                  </p>
                </div>
                <span className="text-slate-700">
                  {g.score}/{g.maxPoints} · {g.percentage}%
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </>
    );
  }

  function WorkList({ items, fmt, tone }: { items: ChildHome['missing']; fmt: (iso: string | null) => string; tone: 'amber' | 'brand' }) {
    if (items.length === 0) return null;
    return (
      <ul className="divide-y divide-slate-100 text-sm">
        {items.map((w) => (
          <li key={w.assignmentId} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <Link href={`/assignments/${w.assignmentId}`} className="font-medium text-slate-900 hover:underline">
              {w.title}
            </Link>
            <span className={`text-xs ${tone === 'amber' ? 'text-amber-800' : 'text-slate-500'}`}>
              {w.className}
              {w.dueAt ? ` · ${t('asg.due', { date: fmt(w.dueAt) })}` : ''}
            </span>
          </li>
        ))}
      </ul>
    );
  }
}

/** Shows exactly what the weekly email would say today, in the family's language. */
function Digest() {
  const t = useI18n().t;
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || preview) return;
    api<{ subject: string; text: string }>('/family/digest').then(setPreview).catch((err) => setError(errorMessage(err)));
  }, [open, preview]);
  return (
    <Card title={t('fam.digest')} description={t('fam.digestDesc')} actions={<Link href="/notifications" className="text-sm text-brand-700 hover:underline">{t('notif.prefs')}</Link>}>
      <Button variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? t('fam.digestHide') : t('fam.digestShow')}
      </Button>
      {open && error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {open && !preview && !error && (
        <div className="mt-3">
          <SkeletonRows rows={3} />
        </div>
      )}
      {open && preview && (
        <div className="mt-3 rounded-lg bg-slate-50 p-4 text-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">{t('fam.digestSubject')}</p>
          <p className="font-medium text-slate-900">{preview.subject}</p>
          <pre className="mt-3 whitespace-pre-wrap font-sans text-slate-700">{preview.text}</pre>
        </div>
      )}
    </Card>
  );
}
