'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { SkeletonRows } from '@/components/motion';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CLASS_STATUSES, type ClassItem } from '@/lib/curriculum';
import { useT } from '@/lib/i18n';
import { label, type Paged } from '@/lib/students';

export default function ClassesPage() {
  const { can } = useAuth();
  const t = useT();
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paged<ClassItem> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (search) q.set('search', search);
      if (term) q.set('term', term);
      if (status) q.set('status', status);
      setResult(await api<Paged<ClassItem>>(`/classes?${q.toString()}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [page, search, term, status]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 200);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('cls.title')}</h1>
        {can('classes.create') && (
          <Link href="/classes/new">
            <Button>{t('cls.new')}</Button>
          </Link>
        )}
      </div>
      <Card>
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <Input label={t('common.search')} placeholder={t('cls.searchPh')} value={search} onChange={(e) => (setPage(1), setSearch(e.target.value))} />
          <Input label={t('cls.term')} placeholder="2026-Fall" value={term} onChange={(e) => (setPage(1), setTerm(e.target.value))} />
          <Select label={t('common.status')} value={status} onChange={(e) => (setPage(1), setStatus(e.target.value))}>
            <option value="">{t('common.allStatuses')}</option>
            {CLASS_STATUSES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </Select>
        </div>
        {error && <Alert>{error}</Alert>}
        {!result && !error && <SkeletonRows rows={4} />}
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Classes table">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-4">{t('common.class')}</th>
                <th className="py-2 pr-4">{t('cls.col.course')}</th>
                <th className="py-2 pr-4">{t('cls.term')}</th>
                <th className="py-2 pr-4">{t('cls.col.teachers')}</th>
                <th className="py-2 pr-4">{t('cls.col.enrolled')}</th>
                <th className="py-2">{t('common.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result?.data.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="py-2 pr-4 font-medium text-slate-800">
                    <Link href={`/classes/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-slate-600">
                    {c.course.courseCode} · {c.course.title}
                  </td>
                  <td className="py-2 pr-4">{c.term}</td>
                  <td className="py-2 pr-4 text-slate-600">{c.teachers.map((x) => `${x.firstName} ${x.lastName}${x.isPrimary ? '' : ` ${t('cls.co')}`}`).join(', ') || '—'}</td>
                  <td className="py-2 pr-4">
                    {c.enrolledCount}
                    {c.maxStudents ? ` / ${c.maxStudents}` : ''}
                    {c.waitlistedCount ? ` ${t('cls.waiting', { n: c.waitlistedCount })}` : ''}
                  </td>
                  <td className="py-2">{label(c.status)}</td>
                </tr>
              ))}
              {result && result.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500">
                    {t('cls.noMatch')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
