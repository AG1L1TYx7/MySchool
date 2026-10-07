'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CurveChart, bandName } from '@/components/learning-cards';
import { MotionItem, MotionList, SkeletonRows } from '@/components/motion';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Card } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { bandClass, type ClassMastery, type LearningCurve } from '@/lib/learning';

/** Teacher view of the class as a whole: mastery per standard, who needs help, and the class learning curve. Staff only. */
export default function ClassLearningPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { t } = useI18n();
  const [data, setData] = useState<ClassMastery | null>(null);
  const [curve, setCurve] = useState<LearningCurve | null>(null);
  const [error, setError] = useState<string | null>(null);
  const allowed = can('learning.records');

  useEffect(() => {
    if (!allowed) return;
    Promise.all([api<ClassMastery>(`/classes/${id}/mastery`), api<LearningCurve>(`/classes/${id}/learning/curve`)])
      .then(([m, c]) => {
        setData(m);
        setCurve(c);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [allowed, id]);

  if (!allowed) return <NotForYou what="class learning" back={`/classes/${id}`} />;
  if (error) return <Alert>{error}</Alert>;
  if (!data || !curve) return <SkeletonRows rows={4} />;

  const needsHelp = new Map<string, { name: string; standards: string[] }>();
  for (const s of data.standards) for (const h of s.needsHelp) needsHelp.set(h.studentId, { name: h.name, standards: [...(needsHelp.get(h.studentId)?.standards ?? []), s.code] });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-sm text-slate-500">
          <Link href={`/classes/${id}`} className="hover:underline">
            {data.class.name}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">Class learning</h1>
        <p className="mt-1 text-sm text-slate-500">Mastery per standard from lessons, practice and graded work, with recent evidence weighted higher. {data.students} enrolled. Students never see each other&apos;s numbers.</p>
      </div>

      <Card title="Learning curve" description="Average score on completed work each week across the class, and how much they remembered in practice.">
        <CurveChart curve={curve} />
      </Card>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2">
          <Card title="Standards" description="Each standard taught in this class, the class average, and how many students sit in each band.">
            {data.standards.length === 0 ? (
              <p className="text-sm text-slate-500">No evidence yet. Tag assignments and lessons with standards, then grade work or let students finish lessons.</p>
            ) : (
              <MotionList className="divide-y divide-slate-100">
                {data.standards.map((s) => (
                  <MotionItem key={s.standardId} className="py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-slate-900">
                        {s.code}
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${bandClass(s.band)}`}>{bandName(s.band, t)}</span>
                      </p>
                      <p className="text-slate-700">
                        <span className="text-base font-semibold text-slate-900">{Math.round(s.average * 100)}%</span> · {s.measured} of {data.students} measured
                      </p>
                    </div>
                    <p className="text-xs text-slate-600">{s.description}</p>
                    <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Advanced ${s.counts.advanced}, proficient ${s.counts.proficient}, developing ${s.counts.developing}, beginning ${s.counts.beginning}`}>
                      <span className="bg-green-600" style={{ width: `${(s.counts.advanced / Math.max(1, s.measured)) * 100}%` }} />
                      <span className="bg-green-400" style={{ width: `${(s.counts.proficient / Math.max(1, s.measured)) * 100}%` }} />
                      <span className="bg-brand-400" style={{ width: `${(s.counts.developing / Math.max(1, s.measured)) * 100}%` }} />
                      <span className="bg-amber-400" style={{ width: `${(s.counts.beginning / Math.max(1, s.measured)) * 100}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      Advanced {s.counts.advanced} · Proficient {s.counts.proficient} · Developing {s.counts.developing} · Beginning {s.counts.beginning}
                    </p>
                  </MotionItem>
                ))}
              </MotionList>
            )}
          </Card>
        </div>
        <Card title="Needs help" description="Students below the developing band on at least one standard. Open their profile for the full picture.">
          {needsHelp.size === 0 ? (
            <p className="text-sm text-slate-500">Nobody is below the developing band right now.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {[...needsHelp.entries()].map(([studentId, h]) => (
                <li key={studentId}>
                  <Link href={`/students/${studentId}`} className="font-medium text-brand-700 hover:underline">
                    {h.name}
                  </Link>
                  <p className="text-xs text-slate-600">{h.standards.join(', ')}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
