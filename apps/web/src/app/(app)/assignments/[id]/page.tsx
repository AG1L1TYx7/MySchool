'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { H5pPlayer } from '@/components/h5p-player';
import { Celebration, ProgressBar, SkeletonRows } from '@/components/motion';
import { StandardChips } from '@/components/standards-picker';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, download, errorMessage, upload } from '@/lib/api';
import { fmtDate, type Assignment, type FileMeta, type Grade, type Submission, type SubmissionRow } from '@/lib/academics';
import { useAuth } from '@/lib/auth';
import { MARK_LABELS, MARK_TONES, TEACHER_MARKS, type ClassGrading } from '@/lib/gradebook';
import { label } from '@/lib/students';

export default function AssignmentPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [a, setA] = useState<Assignment | null>(null);
  const [state, setState] = useState<{ error?: string; ok?: string; busy?: boolean }>({});

  const load = useCallback(async () => {
    try {
      setA(await api<Assignment>(`/assignments/${id}`));
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(ok: string, fn: () => Promise<unknown>) {
    setState({ busy: true });
    try {
      await fn();
      setState({ ok });
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }

  if (!a) return state.error ? <Alert>{state.error}</Alert> : <SkeletonRows rows={3} />;
  const isStudent = user?.role === 'student';

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">
            <Link href={`/classes/${a.classId}`} className="hover:underline">
              {a.className}
            </Link>{' '}
            · {a.courseTitle}
          </p>
          <h1 className="text-2xl font-semibold">{a.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {label(a.type)} · {label(a.submissionType)} · {a.maxPoints} points · due {fmtDate(a.dueAt)}
            {a.allowLateUntil ? ` · late until ${fmtDate(a.allowLateUntil)}` : ''}
            {a.latePenaltyPercent ? ` · ${a.latePenaltyPercent}% late penalty` : ''}
            {a.maxAttempts ? ` · ${a.maxAttempts} attempt${a.maxAttempts === 1 ? '' : 's'}` : ''}
            {a.category ? ` · ${a.category}` : ''}
            {a.isExtraCredit ? ' · extra credit' : ''}
            {' · '}
            <span className={a.status === 'published' ? 'text-green-700' : 'text-slate-600'}>{label(a.status)}</span>
            {a.myMark && <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${MARK_TONES[a.myMark]}`}>{MARK_LABELS[a.myMark]}</span>}
          </p>
          {a.standards.length > 0 && (
            <div className="mt-2">
              <StandardChips standards={a.standards} />
            </div>
          )}
        </div>
        {a.canManage && (
          <div className="flex gap-2">
            {a.status === 'draft' && (
              <Button loading={state.busy} onClick={() => void run('Published.', () => api(`/assignments/${id}/publish`, { method: 'POST' }))}>
                Publish
              </Button>
            )}
            {a.status === 'published' && (
              <Button variant="secondary" loading={state.busy} onClick={() => void run('Closed.', () => api(`/assignments/${id}/close`, { method: 'POST' }))}>
                Close
              </Button>
            )}
          </div>
        )}
      </div>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}
      {(a.description || a.instructions) && (
        <Card>
          {a.description && <p className="whitespace-pre-wrap text-sm text-slate-800">{a.description}</p>}
          {a.instructions && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{a.instructions}</p>}
        </Card>
      )}
      {a.h5pContent && a.canManage && (
        <Card title="Interactive activity" description="Students play this activity here; their score posts to the gradebook automatically.">
          <p className="text-sm text-slate-700">
            <Link href={`/content/${a.h5pContent.id}`} className="font-medium text-brand-700 hover:underline">
              {a.h5pContent.title}
            </Link>{' '}
            · {a.h5pContent.maxScore} item{a.h5pContent.maxScore === 1 ? '' : 's'} · scaled to {a.maxPoints} points
            {a.h5pContent.status !== 'published' ? <span className="text-amber-700"> · not published: students cannot play it yet</span> : null}
          </p>
        </Card>
      )}
      {a.rubric && (
        <Card title={`Rubric: ${a.rubric.title}`}>
          <ul className="text-sm text-slate-700">
            {a.rubric.criteria.map((c) => (
              <li key={c.id} className="flex justify-between border-b border-slate-100 py-1 last:border-0">
                <span>
                  {c.title}
                  {c.description ? <span className="text-slate-500"> · {c.description}</span> : null}
                </span>
                <span className="text-slate-500">{c.maxPoints} pts</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {a.canManage ? <TeacherSubmissions assignment={a} /> : <LearnerView assignment={a} canSubmit={isStudent} onChange={load} />}
    </div>
  );
}

function LearnerView({ assignment, canSubmit, onChange }: { assignment: Assignment; canSubmit: boolean; onChange: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [celebrate, setCelebrate] = useState<string | null>(null);
  const [state, setState] = useState<{ error?: string; busy?: boolean }>({});
  const subs = assignment.mySubmissions ?? [];
  const attemptsLeft = assignment.maxAttempts ? assignment.maxAttempts - subs.length : null;
  const open = assignment.status === 'published' && (assignment.submissionType === 'online' || assignment.submissionType === 'external');

  async function addFile(file: File) {
    setState({ busy: true });
    try {
      setFiles((f) => [...f, { ...{ id: '', originalName: '', mimeType: '', sizeBytes: 0, downloadUrl: '' } }].slice(0, -1));
      const meta = await upload<FileMeta>('/files?category=submission', file);
      setFiles((f) => [...f, meta]);
      setState({});
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      const created = await api<Submission>(`/assignments/${assignment.id}/submissions`, { method: 'POST', body: { textContent: text || undefined, fileIds: files.map((f) => f.id) } });
      setText('');
      setFiles([]);
      setState({});
      setCelebrate(created.isLate ? 'Submitted (late). Better late than never.' : 'Submitted. Nice work!');
      await onChange();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }

  return (
    <>
      <Celebration show={celebrate !== null} title={celebrate ?? ''} message={`Attempt ${subs.length + 1} is in for ${assignment.title}.`} onDone={() => setCelebrate(null)} />
      <Card title="Your work">
        {subs.length === 0 && <p className="text-sm text-slate-500">Nothing submitted yet.</p>}
        <ul className="divide-y divide-slate-100">
          {subs.map((s) => (
            <SubmissionCard key={s.id} s={s} />
          ))}
        </ul>
      </Card>
      {canSubmit && open && assignment.h5pContent && (attemptsLeft === null || attemptsLeft > 0) && (
        <Card title={subs.length ? 'Play again' : 'Play the activity'} description={`${assignment.h5pContent.maxScore} item${assignment.h5pContent.maxScore === 1 ? '' : 's'}; your score posts to the gradebook when you finish.${attemptsLeft !== null ? ` ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left.` : ''}`}>
          <H5pPlayer contentId={assignment.h5pContent.id} assignmentId={assignment.id} onResult={() => void onChange()} />
        </Card>
      )}
      {canSubmit && open && !assignment.h5pContent && (attemptsLeft === null || attemptsLeft > 0) && (
        <Card title={subs.length ? 'Submit another attempt' : 'Submit'} description={attemptsLeft !== null ? `${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left.` : undefined}>
          <form onSubmit={submit} className="space-y-4" noValidate>
            {state.error && <Alert>{state.error}</Alert>}
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Your answer</span>
              <textarea className="block w-full rounded-md border-0 px-3 py-2 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500 sm:text-sm" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
            </label>
            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700">Attachments</span>
              <input type="file" className="block text-sm" onChange={(e) => e.target.files?.[0] && void addFile(e.target.files[0])} />
              {files.length > 0 && (
                <ul className="mt-2 text-sm text-slate-700">
                  {files.map((f) => (
                    <li key={f.id}>
                      {f.originalName} <span className="text-xs text-slate-500">({Math.round(f.sizeBytes / 1024)} KB)</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Button type="submit" loading={state.busy} disabled={!text.trim() && files.length === 0}>
              Submit
            </Button>
          </form>
        </Card>
      )}
    </>
  );
}

function SubmissionCard({ s }: { s: Submission }) {
  return (
    <li className="py-3 text-sm">
      <p className="font-medium text-slate-800">
        Attempt {s.attemptNumber} · {label(s.status)}
        {s.isLate && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">late</span>}
        <span className="ml-2 text-xs font-normal text-slate-500">{fmtDate(s.submittedAt)}</span>
      </p>
      {s.textContent && <p className="mt-1 whitespace-pre-wrap text-slate-700">{s.textContent}</p>}
      {s.files.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-2">
          {s.files.map((f) => (
            <li key={f.id}>
              <button className="text-brand-700 underline" onClick={() => void download(`/files/${f.id}/download`, f.originalName)}>
                {f.originalName}
              </button>
            </li>
          ))}
        </ul>
      )}
      {s.grade && <GradeBadge g={s.grade} />}
    </li>
  );
}

function GradeBadge({ g }: { g: Grade }) {
  return (
    <div className="mt-2 rounded-md bg-green-50 p-3 text-sm text-green-900">
      <p className="font-medium">
        {g.score} / {g.maxPoints} ({g.percentage}%{g.letterGrade ? `, ${g.letterGrade}` : ''})
        {g.latePenaltyApplied ? <span className="ml-2 text-xs font-normal">late penalty {g.latePenaltyApplied}% applied</span> : null}
      </p>
      <div className="mt-2">
        <ProgressBar value={g.percentage} label="Score" tone={g.percentage >= 90 ? 'green' : g.percentage >= 60 ? 'brand' : 'amber'} />
      </div>
      {g.standardScores.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1 text-xs">
          {g.standardScores.map((s) => (
            <li key={s.standardId} className="rounded-full bg-white px-2 py-0.5 ring-1 ring-inset ring-green-200">
              {s.level} · {s.label}
            </li>
          ))}
        </ul>
      )}
      {g.feedback && <p className="mt-1 whitespace-pre-wrap">{g.feedback}</p>}
    </div>
  );
}

function TeacherSubmissions({ assignment }: { assignment: Assignment }) {
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState<string | null>(null);
  const [grading, setGrading] = useState<ClassGrading | null>(null);
  useEffect(() => {
    api<ClassGrading>(`/classes/${assignment.classId}/grading`)
      .then(setGrading)
      .catch(() => setGrading(null));
  }, [assignment.classId]);
  async function setMark(studentId: string, mark: string) {
    try {
      await api(`/assignments/${assignment.id}/marks/${studentId}`, { method: 'PUT', body: { mark: mark || null } });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  const load = useCallback(async () => {
    try {
      setRows((await api<{ data: SubmissionRow[] }>(`/assignments/${assignment.id}/submissions`)).data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [assignment.id]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Card title="Submissions" description={`${rows.filter((r) => r.submission).length} of ${rows.length} students have submitted; ${rows.filter((r) => r.grade).length} graded.`}>
      <Celebration show={celebrate !== null} title="Grade posted" message={celebrate ?? undefined} onDone={() => setCelebrate(null)} />
      {rows.length > 0 && (
        <div className="mb-4">
          <ProgressBar value={rows.filter((r) => r.grade).length} max={rows.length} label="Graded" tone={rows.every((r) => r.grade) ? 'green' : 'brand'} />
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.student.id} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium text-slate-800">
                <Link href={`/students/${r.student.id}`} className="hover:underline">
                  {r.student.lastName}, {r.student.firstName}
                </Link>
                <span className="ml-2 font-mono text-xs text-slate-500">{r.student.studentNumber}</span>
              </span>
              <span className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className={`rounded-full px-2 py-0.5 ${MARK_TONES[r.mark]}`}>{MARK_LABELS[r.mark]}</span>
                {r.submission ? `${label(r.submission.status)} · attempt ${r.submission.attemptNumber} · ${fmtDate(r.submission.submittedAt)}${r.submission.isLate ? ' · late' : ''}` : 'No submission'}
                {r.grade ? ` · ${r.grade.score}/${r.grade.maxPoints}` : ''}
                <select aria-label={`Mark for ${r.student.firstName} ${r.student.lastName}`} className="rounded-md border-0 py-0.5 text-xs ring-1 ring-inset ring-slate-300" value={TEACHER_MARKS.includes(r.mark as (typeof TEACHER_MARKS)[number]) ? r.mark : ''} onChange={(e) => void setMark(r.student.id, e.target.value)}>
                  <option value="">Set a mark…</option>
                  {TEACHER_MARKS.map((m) => (
                    <option key={m} value={m}>
                      {MARK_LABELS[m]}
                    </option>
                  ))}
                </select>
              </span>
            </div>
            {r.submission && (
              <GradeForm
                assignment={assignment}
                grading={grading}
                submission={r.submission}
                grade={r.grade}
                onGraded={async () => {
                  setCelebrate(`${r.student.firstName} ${r.student.lastName} will see it right away.`);
                  await load();
                }}
              />
            )}
          </li>
        ))}
        {rows.length === 0 && <li className="py-6 text-center text-sm text-slate-500">No students enrolled.</li>}
      </ul>
    </Card>
  );
}

function GradeForm({ assignment, grading, submission, grade, onGraded }: { assignment: Assignment; grading: ClassGrading | null; submission: Submission; grade: Grade | null; onGraded: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const standardsMode = grading?.gradingMode === 'standards' && assignment.standards.length > 0;
  const levels = grading?.scale?.levels ?? [];
  const [levelByStandard, setLevelByStandard] = useState<Record<string, string>>(() => Object.fromEntries((grade?.standardScores ?? []).map((s) => [s.standardId, String(s.level)])));
  const [score, setScore] = useState(grade ? String(grade.score) : '');
  const [feedback, setFeedback] = useState(grade?.feedback ?? '');
  const [rubric, setRubric] = useState<Record<string, string>>(() => Object.fromEntries((grade?.rubricScores ?? []).map((r) => [r.criterionId, String(r.points)])));
  const [waive, setWaive] = useState(false);
  const [state, setState] = useState<{ error?: string; busy?: boolean }>({});
  const criteria = assignment.rubric?.criteria ?? [];
  const rubricTotal = criteria.reduce((s, c) => s + Number(rubric[c.id] ?? 0), 0);

  async function save(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      await api(`/submissions/${submission.id}/grade`, {
        method: 'POST',
        body: { score: Number(score), feedback: feedback || undefined, waiveLatePenalty: waive, rubricScores: criteria.length ? criteria.map((c) => ({ criterionId: c.id, points: Number(rubric[c.id] ?? 0) })) : undefined, standardScores: standardsMode ? assignment.standards.filter((s) => levelByStandard[s.id]).map((s) => ({ standardId: s.id, level: Number(levelByStandard[s.id]) })) : undefined },
      });
      setState({});
      setOpen(false);
      await onGraded();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }

  return (
    <div className="mt-2">
      <button className="text-sm font-medium text-brand-700 hover:underline" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide' : grade ? 'View / regrade' : 'View and grade'}
      </button>
      {open && (
        <div className="mt-2 grid gap-4 rounded-md bg-slate-50 p-4 md:grid-cols-2">
          <div className="text-sm">
            {submission.textContent && <p className="whitespace-pre-wrap text-slate-800">{submission.textContent}</p>}
            {submission.files.map((f) => (
              <p key={f.id}>
                <button className="text-brand-700 underline" onClick={() => void download(`/files/${f.id}/download`, f.originalName)}>
                  {f.originalName}
                </button>
              </p>
            ))}
            {!submission.textContent && submission.files.length === 0 && <p className="text-slate-500">Empty submission.</p>}
          </div>
          <form onSubmit={save} className="space-y-3" noValidate>
            {state.error && <Alert>{state.error}</Alert>}
            {criteria.length > 0 && (
              <div className="space-y-2">
                {criteria.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1">
                      {c.title} <span className="text-xs text-slate-500">/ {c.maxPoints}</span>
                    </span>
                    <input type="number" min="0" max={c.maxPoints} step="0.5" className="w-20 rounded-md border-0 py-1 text-sm ring-1 ring-inset ring-slate-300" value={rubric[c.id] ?? ''} onChange={(e) => setRubric((r) => ({ ...r, [c.id]: e.target.value }))} />
                  </div>
                ))}
                <button type="button" className="text-xs text-brand-700 underline" onClick={() => setScore(String(Math.min(rubricTotal, assignment.maxPoints)))}>
                  Use rubric total ({rubricTotal})
                </button>
              </div>
            )}
            <Input label={`Score (out of ${assignment.maxPoints})`} type="number" min="0" max={assignment.maxPoints} step="0.5" value={score} onChange={(e) => setScore(e.target.value)} />
            {standardsMode && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-slate-700">Level per standard (leave blank to derive from the score)</legend>
                {assignment.standards.map((s) => (
                  <Select key={s.id} label={s.code} value={levelByStandard[s.id] ?? ''} onChange={(e) => setLevelByStandard((m) => ({ ...m, [s.id]: e.target.value }))}>
                    <option value="">From score</option>
                    {levels.map((l) => (
                      <option key={l.level} value={l.level}>
                        {l.level} · {l.label}
                      </option>
                    ))}
                  </Select>
                ))}
              </fieldset>
            )}
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Feedback</span>
              <textarea className="block w-full rounded-md border-0 px-3 py-2 text-sm shadow-sm ring-1 ring-inset ring-slate-300" rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
            </label>
            {submission.isLate && assignment.latePenaltyPercent ? (
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} /> Waive the {assignment.latePenaltyPercent}% late penalty
              </label>
            ) : null}
            <Button type="submit" loading={state.busy} disabled={score === ''}>
              {grade ? 'Update grade' : 'Post grade'}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
