'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { MotionItem, MotionList, SkeletonRows } from '@/components/motion';
import { Alert, Button, Card } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { BAND_LABELS, KIND_LABELS, bandClass, stepClass, type ClassPathRow, type LearningPath, type Profile, type Step } from '@/lib/paths';

/** The learning health score with every part explained, the gaps, and what to do next. */
export function ProfileCard({ profile, forStudent }: { profile: Profile; forStudent: boolean }) {
  const h = profile.health;
  return (
    <div className="space-y-4">
      <Card title={forStudent ? 'How learning is going' : `${profile.student.firstName}'s learning health`} description="One number from five parts. Each part says what it counted, so nothing here is a guess.">
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-slate-100 text-2xl font-semibold tabular-nums" aria-label={`Learning health ${h.score} of 100`}>
            {h.score}
          </div>
          <div>
            <span className={`rounded px-2 py-0.5 text-sm ${bandClass(h.band)}`}>{BAND_LABELS[h.band]}</span>
            <p className="mt-1 text-xs text-slate-600">Out of 100. Mastery 35%, attendance 20%, work 25%, practice 10%, engagement 10%.</p>
          </div>
        </div>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {h.parts.map((p) => (
            <li key={p.key} className="rounded-lg bg-slate-50 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{p.label}</span>
                <span className="tabular-nums">{p.score}</span>
              </div>
              <div className="mt-1 h-1.5 w-full rounded bg-slate-200" role="presentation">
                <div className="h-1.5 rounded bg-brand-600" style={{ width: `${p.score}%` }} />
              </div>
              <p className="mt-1 text-xs text-slate-600">{p.note}</p>
            </li>
          ))}
        </ul>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Where to focus" description={profile.gaps.length ? 'Standards with evidence below 60%. The weakest come first.' : 'No standards below 60% with evidence. Keep going.'}>
          <ul className="space-y-2 text-sm">
            {profile.gaps.map((g) => (
              <li key={g.standardId} className="flex items-start justify-between gap-3">
                <span>
                  <span className="font-mono text-xs">{g.code}</span> {g.description}
                </span>
                <span className="shrink-0 tabular-nums text-slate-600">{Math.round(g.level * 100)}%</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Next steps" description="Ranked: missing work, then the weakest standards, practice, and the next lesson.">
          {profile.recommendations.length === 0 ? (
            <p className="text-sm text-slate-600">Nothing pressing right now.</p>
          ) : (
            <MotionList className="space-y-2">
              {profile.recommendations.map((r, i) => (
                <MotionItem key={`${r.kind}-${r.refId ?? i}`} className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">{KIND_LABELS[r.kind]}</span>
                    {r.href ? (
                      <Link href={r.href} className="font-medium hover:underline">
                        {r.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{r.title}</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{r.reason}</p>
                </MotionItem>
              ))}
            </MotionList>
          )}
        </Card>
      </div>
    </div>
  );
}

/** One path: steps in order, each with its link, status and evidence; students tick, staff edit. */
export function PathCard({ path, onChange, canEdit }: { path: LearningPath; onChange: () => void; canEdit: boolean }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const setStatus = async (step: Step, status: Step['status']) => {
    setBusy(step.id);
    setError(null);
    try {
      await api(`/learning/paths/${path.id}/steps/${step.id}`, { method: 'PATCH', body: { status } });
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  };
  const remove = async (step: Step) => {
    setBusy(step.id);
    try {
      await api(`/learning/paths/${path.id}/steps/${step.id}`, { method: 'DELETE' });
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  };
  const archive = async () => {
    setBusy('path');
    try {
      await api(`/learning/paths/${path.id}`, { method: 'PATCH', body: { status: path.status === 'archived' ? 'active' : 'archived' } });
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('path');
      setBusy('');
    }
  };
  return (
    <Card title={path.title} description={`${path.progress.done} of ${path.progress.total} steps · ${path.status === 'completed' ? 'completed' : path.status} · ${path.source === 'generated' ? 'built from mastery' : `by ${path.createdBy ?? 'a teacher'}`}`}>
      {error && <Alert>{error}</Alert>}
      {path.goal && <p className="text-sm">{path.goal}</p>}
      {path.rationale && <p className="mt-1 text-xs text-slate-600">Why: {path.rationale}</p>}
      <div className="mt-3 h-2 w-full rounded bg-slate-200" role="progressbar" aria-valuenow={path.progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${path.title} progress`}>
        <div className="h-2 rounded bg-emerald-500" style={{ width: `${path.progress.percent}%` }} />
      </div>
      <ol className="mt-3 space-y-2">
        {path.steps.map((s) => (
          <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-white p-3 ring-1 ring-slate-200">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-600">{s.sortOrder}.</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">{KIND_LABELS[s.kind]}</span>
                {s.href ? (
                  <Link href={s.href} className="font-medium hover:underline">
                    {s.title}
                  </Link>
                ) : (
                  <span className="font-medium">{s.title}</span>
                )}
                <span className={`rounded px-1.5 py-0.5 text-xs ${stepClass(s.status)}`}>{s.status.replace('_', ' ')}</span>
              </div>
              {s.reason && <p className="mt-1 text-xs text-slate-600">{s.reason}</p>}
              {s.evidence && <p className="mt-1 text-xs text-emerald-700">{s.evidence}</p>}
            </div>
            <div className="flex shrink-0 gap-1">
              {s.status !== 'done' && (
                <Button variant="secondary" loading={busy === s.id} onClick={() => void setStatus(s, 'done')}>
                  Done
                </Button>
              )}
              {s.status === 'pending' && (
                <Button variant="ghost" loading={busy === s.id} onClick={() => void setStatus(s, 'skipped')}>
                  Skip
                </Button>
              )}
              {canEdit && (s.status === 'done' || s.status === 'skipped') && (
                <Button variant="ghost" loading={busy === s.id} onClick={() => void setStatus(s, 'pending')}>
                  Reopen
                </Button>
              )}
              {canEdit && (
                <Button variant="ghost" loading={busy === s.id} onClick={() => void remove(s)}>
                  Remove
                </Button>
              )}
            </div>
          </li>
        ))}
      </ol>
      {canEdit && (
        <div className="mt-3 flex justify-end">
          <Button variant="secondary" loading={busy === 'path'} onClick={() => void archive()}>
            {path.status === 'archived' ? 'Reactivate' : 'Archive'}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Staff view on a student's page: the profile, generate or hand-build a path, and the paths. */
export function StudentPathsCard({ studentId }: { studentId: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [paths, setPaths] = useState<LearningPath[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Profile>(`/students/${studentId}/learning/profile`).then(setProfile).catch((e) => setError(errorMessage(e)));
    api<LearningPath[]>(`/students/${studentId}/learning/paths`).then(setPaths).catch((e) => setError(errorMessage(e)));
  }, [studentId]);
  useEffect(load, [load]);
  const generate = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const p = await api<LearningPath>(`/students/${studentId}/learning/paths/generate`, { method: 'POST', body: {} });
      setNote(`Built "${p.title}" with ${p.steps.length} steps.`);
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (error && !profile) return <Alert>{error}</Alert>;
  if (!profile) return <SkeletonRows rows={4} />;
  return (
    <div className="space-y-4">
      <ProfileCard profile={profile} forStudent={false} />
      <Card title="Learning paths" description="A path is a short, ordered set of lessons, activities and practice aimed at this student's weakest standards. Steps finish on their own when the work is done." actions={<Button loading={busy} onClick={() => void generate()}>Build a path from mastery</Button>}>
        {error && <Alert>{error}</Alert>}
        {note && <Alert kind="success">{note}</Alert>}
        {!paths ? <SkeletonRows rows={2} /> : paths.length === 0 ? <p className="text-sm text-slate-600">No paths yet.</p> : null}
      </Card>
      {paths?.map((p) => (
        <PathCard key={p.id} path={p} onChange={load} canEdit />
      ))}
    </div>
  );
}

/** Teacher view on the class learning page: every path of the students in the class. */
export function ClassPathsCard({ classId }: { classId: string }) {
  const [rows, setRows] = useState<ClassPathRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<ClassPathRow[]>(`/classes/${classId}/learning/paths`).then(setRows).catch((e) => setError(errorMessage(e)));
  }, [classId]);
  if (error) return <Alert>{error}</Alert>;
  return (
    <Card title="Learning paths" description="Paths built for students in this class and how far along they are. Open a student to build or change one.">
      {!rows ? (
        <SkeletonRows rows={2} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-600">No paths yet. Open a student&apos;s page and press Build a path from mastery.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <Link href={`/students/${r.student.id}`} className="font-medium hover:underline">
                  {r.student.firstName} {r.student.lastName}
                </Link>
                : {r.title}
              </span>
              <span className="tabular-nums text-slate-600">
                {r.progress.done}/{r.progress.total} · {r.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
