'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { MotionItem, MotionList, SkeletonRows } from '@/components/motion';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { COURSE_STATUSES, type Course } from '@/lib/curriculum';
import { useI18n } from '@/lib/i18n';
import { GRADE_LEVELS, label, type Paged } from '@/lib/students';

export default function CoursesPage() {
  const { can } = useAuth();
  const { t, n } = useI18n();
  const [search, setSearch] = useState('');
  const [grade, setGrade] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paged<Course> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (search) q.set('search', search);
      if (grade) q.set('gradeLevel', grade);
      if (status) q.set('status', status);
      setResult(await api<Paged<Course>>(`/courses?${q.toString()}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [page, search, grade, status]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 200);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('crs.title')}</h1>
        {can('courses.create') && (
          <Link href="/courses/new">
            <Button>{t('crs.new')}</Button>
          </Link>
        )}
      </div>
      <Card>
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <Input label={t('common.search')} placeholder={t('crs.searchPh')} value={search} onChange={(e) => (setPage(1), setSearch(e.target.value))} />
          <Select label={t('common.gradeLevel')} value={grade} onChange={(e) => (setPage(1), setGrade(e.target.value))}>
            <option value="">{t('crs.allGrades')}</option>
            {GRADE_LEVELS.map((g) => (
              <option key={g} value={g}>
                {g === 'K' ? t('common.kindergarten') : t('common.grade', { grade: g })}
              </option>
            ))}
          </Select>
          {can('courses.create') && (
            <Select label={t('common.status')} value={status} onChange={(e) => (setPage(1), setStatus(e.target.value))}>
              <option value="">{t('common.allStatuses')}</option>
              {COURSE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </Select>
          )}
        </div>
        {error && <Alert>{error}</Alert>}
        {!result && !error && <SkeletonRows rows={3} />}
        <MotionList as="div" className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {result?.data.map((c) => (
            <MotionItem key={c.id} as="div">
              <Link href={`/courses/${c.id}`} className="block rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition duration-150 hover:-translate-y-0.5 hover:shadow-md hover:ring-brand-300 motion-reduce:hover:translate-y-0">
                <p className="font-mono text-xs text-slate-500">{c.courseCode}</p>
                <p className="mt-1 font-semibold text-slate-900">{c.title}</p>
                <p className="mt-1 text-sm text-slate-500">{[c.subject, c.gradeLevel ? t('common.grade', { grade: c.gradeLevel }) : null].filter(Boolean).join(' · ') || t('crs.noSubject')}</p>
                <p className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 ${c.isPublished ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-600'}`}>{c.isPublished ? t('common.published') : label(c.status)}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                    {n('crs.modules', c.moduleCount)} · {n('crs.lessons', c.lessonCount)}
                  </span>
                  {c.instructor && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                      {c.instructor.firstName} {c.instructor.lastName}
                    </span>
                  )}
                </p>
              </Link>
            </MotionItem>
          ))}
          {result && result.data.length === 0 && <p className="text-sm text-slate-500">{t('crs.noMatch')}</p>}
        </MotionList>
        {result && result.meta.totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <span>{t('crs.count', { n: result.meta.totalItems })}</span>
            <span className="flex gap-2">
              <button className="disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                {t('common.previous')}
              </button>
              <span>{t('common.pageOf', { page: result.meta.page, total: result.meta.totalPages })}</span>
              <button className="disabled:opacity-40" disabled={page >= result.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
                {t('common.next')}
              </button>
            </span>
          </div>
        )}
      </Card>
    </div>
  );
}
