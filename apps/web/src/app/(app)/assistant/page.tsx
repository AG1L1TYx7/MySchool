'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { MotionItem, MotionList, PillGroup, SkeletonRows } from '@/components/motion';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { fmtDate, type Assignment } from '@/lib/academics';
import { api, errorMessage } from '@/lib/api';
import type { DifferentiationContent, Draft, EmailContent, Insight, LessonPlan, NarrativeContent, PlanContent, SuggestionList } from '@/lib/assistant';
import { useAuth } from '@/lib/auth';
import type { ClassItem, Course, CourseDetail } from '@/lib/curriculum';
import { waitForJob } from '@/lib/family';
import type { Paged, Student } from '@/lib/students';

const SECTIONS = ['plans', 'grading', 'families', 'differentiation', 'insight'] as const;
type Section = (typeof SECTIONS)[number];
const SECTION_LABELS: Record<Section, string> = { plans: 'Lesson plans', grading: 'Grading', families: 'Families', differentiation: 'Differentiation', insight: 'Class insight' };

export default function AssistantPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={4} />}>
      <Assistant />
    </Suspense>
  );
}

/**
 * The teacher assistant (docs/13 section 8). Every section produces a draft the teacher reads and edits;
 * nothing reaches a student, a family or the gradebook without the teacher pressing a button here.
 */
function Assistant() {
  const { can } = useAuth();
  const params = useSearchParams();
  const [section, setSection] = useState<Section>((params.get('section') as Section | null) ?? 'plans');
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const allowed = can('ai.assistant');
  useEffect(() => {
    if (!allowed) return;
    api<{ data: ClassItem[] }>('/classes/mine').then((r) => setClasses(r.data)).catch(() => setClasses([]));
  }, [allowed]);
  if (!allowed) return <NotForYou what="the teacher assistant" back="/dashboard" />;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Teacher assistant</h1>
          <p className="mt-1 text-sm text-slate-500">AI drafts you review before anything reaches students, families or the gradebook. Every draft is labelled.</p>
        </div>
        <Link href="/planner" className="text-sm text-brand-700 hover:underline">
          Weekly planner
        </Link>
      </div>
      <PillGroup name="Assistant section" options={SECTIONS} value={section} onChange={setSection} labels={(s) => SECTION_LABELS[s]} />
      {section === 'plans' && <Plans classes={classes} initialPlanId={params.get('plan')} />}
      {section === 'grading' && <Grading />}
      {section === 'families' && <Families classes={classes} />}
      {section === 'differentiation' && <Differentiation />}
      {section === 'insight' && <ClassInsight classes={classes} />}
    </div>
  );
}

type Busy = { error?: string; ok?: string; busy?: boolean };

// ---------------------------------------------------------------------------
// Lesson plans
// ---------------------------------------------------------------------------

function Plans({ classes, initialPlanId }: { classes: ClassItem[]; initialPlanId: string | null }) {
  const [plans, setPlans] = useState<LessonPlan[] | null>(null);
  const [open, setOpen] = useState<string | null>(initialPlanId);
  const [form, setForm] = useState({ topic: '', classId: '', durationMinutes: '45', standard: '', language: 'en' });
  const [state, setState] = useState<Busy>({});
  const load = useCallback(async () => {
    try {
      setPlans((await api<{ data: LessonPlan[] }>('/assistant/lesson-plans')).data);
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function draft(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      const job = await api<{ id: string }>('/assistant/lesson-plans', { method: 'POST', body: { topic: form.topic, classId: form.classId || undefined, durationMinutes: Number(form.durationMinutes), standard: form.standard || undefined, language: form.language } });
      const done = await waitForJob(job.id);
      await load();
      setOpen(done.resultId);
      setState({ ok: 'Draft ready. Read it through, change what you like, then publish or schedule it.' });
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  const current = plans?.find((p) => p.id === open) ?? null;
  return (
    <>
      <Card title="Draft a lesson plan" description="Say the topic and the class; the AI uses the course outline and any lesson you name. Minutes always add up to the length you ask for.">
        <form onSubmit={(e) => void draft(e)} className="grid gap-3 md:grid-cols-4" noValidate>
          <div className="md:col-span-2">
            <Input label="Topic" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} required />
          </div>
          <Select label="Class" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
            <option value="">No class (general)</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input label="Minutes" type="number" min="10" max="240" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} />
          <div className="md:col-span-2">
            <Input label="Standard (optional)" placeholder="e.g. CCSS.ELA-LITERACY.W.7.3" value={form.standard} onChange={(e) => setForm({ ...form, standard: e.target.value })} />
          </div>
          <Select label="Language" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
            <option value="en">English</option>
            <option value="es">Spanish</option>
          </Select>
          <div className="flex items-end">
            <Button type="submit" loading={state.busy} disabled={form.topic.trim().length < 2}>
              {state.busy ? 'Drafting…' : 'Draft plan'}
            </Button>
          </div>
        </form>
        {state.error && (
          <div className="mt-3">
            <Alert>{state.error}</Alert>
          </div>
        )}
        {state.ok && (
          <div className="mt-3">
            <Alert kind="success">{state.ok}</Alert>
          </div>
        )}
      </Card>
      {current ? (
        <PlanEditor plan={current} classes={classes} onClose={() => setOpen(null)} onChanged={load} />
      ) : (
        <Card title="My plans">
          {plans === null && <SkeletonRows rows={3} />}
          {plans && plans.length === 0 && <p className="text-sm text-slate-500">No plans yet.</p>}
          <MotionList className="divide-y divide-slate-100">
            {(plans ?? []).map((p) => (
              <MotionItem key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <button type="button" className="text-left font-medium text-slate-900 hover:underline" onClick={() => setOpen(p.id)}>
                  {p.title}
                </button>
                <span className="text-xs text-slate-500">
                  {p.className ? `${p.className} · ` : ''}
                  {p.durationMinutes} min · {p.status === 'published' ? 'published' : 'draft'}
                  {p.scheduledOn ? ` · ${p.scheduledOn}` : ''}
                  {p.aiGenerated ? ' · AI draft' : ''}
                </span>
              </MotionItem>
            ))}
          </MotionList>
        </Card>
      )}
    </>
  );
}

function PlanEditor({ plan, classes, onClose, onChanged }: { plan: LessonPlan; classes: ClassItem[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [title, setTitle] = useState(plan.title);
  const [content, setContent] = useState<PlanContent>(plan.content);
  const [scheduledOn, setScheduledOn] = useState(plan.scheduledOn ?? '');
  const [classId, setClassId] = useState(plan.classId ?? '');
  const [state, setState] = useState<Busy>({});
  const lines = (v: string[] | undefined) => (v ?? []).join('\n');
  const split = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean);
  const area = 'block w-full rounded-md border-0 px-3 py-2 text-sm shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500';
  async function save(status?: 'draft' | 'published') {
    setState({ busy: true });
    try {
      await api(`/lesson-plans/${plan.id}`, { method: 'PATCH', body: { title, content, scheduledOn, classId: classId || undefined, ...(status ? { status } : {}) } });
      setState({ ok: status === 'published' ? 'Published. It shows on your planner on its date.' : 'Saved.' });
      await onChanged();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  const total = (content.sequence ?? []).reduce((s, p) => s + Number(p.minutes || 0), 0);
  return (
    <Card title={plan.title} description={`${plan.durationMinutes} minutes · ${plan.status}${plan.aiGenerated ? ' · AI draft, reviewed by you' : ''}`} actions={<Button variant="ghost" onClick={onClose}>Back to list</Button>}>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="md:col-span-2">
          <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <Select label="Class" value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">None</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <label className="block md:col-span-3">
          <span className="mb-1 block text-sm font-medium text-slate-700">Objectives (one per line)</span>
          <textarea className={area} rows={3} value={lines(content.objectives)} onChange={(e) => setContent({ ...content, objectives: split(e.target.value) })} />
        </label>
        <label className="block md:col-span-3">
          <span className="mb-1 block text-sm font-medium text-slate-700">Materials (one per line)</span>
          <textarea className={area} rows={2} value={lines(content.materials)} onChange={(e) => setContent({ ...content, materials: split(e.target.value) })} />
        </label>
      </div>
      <h3 className="mt-4 text-sm font-semibold text-slate-800">
        Sequence <span className={`font-normal ${total === plan.durationMinutes ? 'text-slate-500' : 'text-amber-700'}`}>({total} of {plan.durationMinutes} minutes)</span>
      </h3>
      <div className="mt-2 space-y-2">
        {(content.sequence ?? []).map((p, i) => (
          <div key={i} className="grid gap-2 rounded-md bg-slate-50 p-3 md:grid-cols-[1fr_80px_2fr_2fr]">
            <Input label="Phase" value={p.phase} onChange={(e) => setContent({ ...content, sequence: content.sequence!.map((x, j) => (j === i ? { ...x, phase: e.target.value } : x)) })} />
            <Input label="Min" type="number" min="1" value={String(p.minutes)} onChange={(e) => setContent({ ...content, sequence: content.sequence!.map((x, j) => (j === i ? { ...x, minutes: Number(e.target.value) } : x)) })} />
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Teacher does</span>
              <textarea className={area} rows={2} value={p.teacherDoes} onChange={(e) => setContent({ ...content, sequence: content.sequence!.map((x, j) => (j === i ? { ...x, teacherDoes: e.target.value } : x)) })} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Students do</span>
              <textarea className={area} rows={2} value={p.studentsDo} onChange={(e) => setContent({ ...content, sequence: content.sequence!.map((x, j) => (j === i ? { ...x, studentsDo: e.target.value } : x)) })} />
            </label>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Support (students who struggle)</span>
          <textarea className={area} rows={2} value={content.differentiation?.support ?? ''} onChange={(e) => setContent({ ...content, differentiation: { ...content.differentiation, support: e.target.value } })} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Extension (students who finish early)</span>
          <textarea className={area} rows={2} value={content.differentiation?.extension ?? ''} onChange={(e) => setContent({ ...content, differentiation: { ...content.differentiation, extension: e.target.value } })} />
        </label>
      </div>
      {(content.exitCheck ?? []).length > 0 && (
        <div className="mt-3 text-sm">
          <p className="font-medium text-slate-800">Exit check</p>
          <ol className="list-decimal pl-5 text-slate-700">
            {content.exitCheck!.map((q, i) => (
              <li key={i}>
                {q.question} <span className="text-slate-500">({q.answer})</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <Input label="Schedule on" type="date" value={scheduledOn} onChange={(e) => setScheduledOn(e.target.value)} />
        <Button variant="secondary" loading={state.busy} onClick={() => void save()}>
          Save
        </Button>
        {plan.status !== 'published' && (
          <Button loading={state.busy} onClick={() => void save('published')}>
            Publish
          </Button>
        )}
        <Button variant="ghost" disabled={state.busy} onClick={() => void api(`/lesson-plans/${plan.id}`, { method: 'DELETE' }).then(onChanged).then(onClose).catch((err) => setState({ error: errorMessage(err) }))}>
          Delete
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Grading suggestions
// ---------------------------------------------------------------------------

function Grading() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assignmentId, setAssignmentId] = useState('');
  const [list, setList] = useState<SuggestionList | null>(null);
  const [state, setState] = useState<Busy>({});
  const [edits, setEdits] = useState<Record<string, { score: string; feedback: string }>>({});
  useEffect(() => {
    api<Paged<Assignment>>('/assignments?pageSize=100&status=published').then((r) => setAssignments(r.data)).catch(() => setAssignments([]));
  }, []);
  const load = useCallback(async () => {
    if (!assignmentId) return setList(null);
    try {
      setList(await api<SuggestionList>(`/assistant/grading/assignments/${assignmentId}`));
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, [assignmentId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function suggest() {
    setState({ busy: true });
    try {
      const r = await api<{ started: number; skipped: { graded: number; pending: number; noText: number }; jobs: Array<{ jobId: string }> }>(`/assistant/grading/assignments/${assignmentId}/suggest`, { method: 'POST' });
      await Promise.all(r.jobs.map((j) => waitForJob(j.jobId).catch(() => null)));
      await load();
      setState({ ok: `${r.started} suggestion${r.started === 1 ? '' : 's'} ready. Skipped: ${r.skipped.graded} already graded, ${r.skipped.pending} waiting for you, ${r.skipped.noText} without text (grade those by hand).` });
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  async function approve(id: string) {
    const e = edits[id];
    setState({ busy: true });
    try {
      await api(`/grading-suggestions/${id}/approve`, { method: 'POST', body: { ...(e?.score ? { score: Number(e.score) } : {}), ...(e?.feedback ? { feedback: e.feedback } : {}) } });
      await load();
      setState({ ok: 'Grade posted.' });
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  async function approveAll() {
    setState({ busy: true });
    try {
      const r = await api<{ approved: number; left: number }>(`/assistant/grading/assignments/${assignmentId}/approve-all`, { method: 'POST' });
      await load();
      setState({ ok: `${r.approved} grade${r.approved === 1 ? '' : 's'} posted; ${r.left} left for your review.` });
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  const pending = list?.data.filter((s) => s.status === 'pending') ?? [];
  return (
    <>
      <Card title="Grading suggestions" description="The AI scores each text submission against the rubric (or an overall criterion), quotes its evidence and says how sure it is. You approve, change or reject; unsure ones never post by themselves.">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[280px] flex-1">
            <Select label="Assignment" value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)}>
              <option value="">Choose</option>
              {assignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.className} · {a.title}
                </option>
              ))}
            </Select>
          </div>
          <Button onClick={() => void suggest()} loading={state.busy} disabled={!assignmentId}>
            Suggest grades
          </Button>
          <Button variant="secondary" onClick={() => void approveAll()} loading={state.busy} disabled={!pending.some((s) => !s.needsHumanReview)}>
            Approve all confident
          </Button>
        </div>
        {state.error && (
          <div className="mt-3">
            <Alert>{state.error}</Alert>
          </div>
        )}
        {state.ok && (
          <div className="mt-3">
            <Alert kind="success">{state.ok}</Alert>
          </div>
        )}
      </Card>
      {list && (
        <Card title={list.assignment.title} description={`Out of ${list.assignment.maxPoints} points${list.assignment.hasRubric ? ', by rubric criterion' : ''}. ${list.data.length} suggestion${list.data.length === 1 ? '' : 's'}.`}>
          {list.data.length === 0 && <p className="text-sm text-slate-500">No suggestions yet. Press Suggest grades.</p>}
          <div className="space-y-4">
            {list.data.map((s) => (
              <article key={s.id} className={`rounded-lg p-4 ring-1 ${s.needsHumanReview && s.status === 'pending' ? 'bg-amber-50/50 ring-amber-200' : 'bg-white ring-slate-200'}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">
                      {s.student.lastName}, {s.student.firstName}
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        attempt {s.attemptNumber}
                        {s.isLate ? ' · late' : ''}
                      </span>
                    </p>
                    <p className="text-xs text-slate-500">
                      Suggested {s.suggestedPoints} of {list.assignment.maxPoints} · confidence {Math.round(s.confidence * 100)}%
                      {s.needsHumanReview ? ' · needs your review' : ''}
                      {s.flag ? ` · flag: ${s.flag}` : ''}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${s.status === 'approved' ? 'bg-green-100 text-green-800' : s.status === 'rejected' ? 'bg-slate-100 text-slate-600' : 'bg-brand-50 text-brand-800'}`}>{s.status}</span>
                </div>
                <p className="mt-2 line-clamp-3 text-sm text-slate-600">“{s.excerpt}”</p>
                {s.content.criteria && (
                  <ul className="mt-2 space-y-1 text-sm">
                    {s.content.criteria.map((c) => (
                      <li key={c.criterionId}>
                        <span className="font-medium text-slate-800">{c.criterionId}</span> {c.score}/{c.maxPoints}
                        {c.evidence ? <span className="text-slate-500"> · “{c.evidence}”</span> : null}
                        {c.feedback ? <span className="block text-slate-600">{c.feedback}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
                {s.content.summary && <p className="mt-2 text-sm italic text-slate-600">{s.content.summary}</p>}
                {s.status === 'pending' && (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <Input label="Score" type="number" min="0" max={list.assignment.maxPoints} step="0.5" value={edits[s.id]?.score ?? String(s.suggestedPoints)} onChange={(e) => setEdits({ ...edits, [s.id]: { score: e.target.value, feedback: edits[s.id]?.feedback ?? '' } })} />
                    <div className="min-w-[280px] flex-1">
                      <Input label="Feedback (optional override)" value={edits[s.id]?.feedback ?? ''} onChange={(e) => setEdits({ ...edits, [s.id]: { score: edits[s.id]?.score ?? String(s.suggestedPoints), feedback: e.target.value } })} />
                    </div>
                    <Button onClick={() => void approve(s.id)} loading={state.busy}>
                      Post grade
                    </Button>
                    <Button variant="ghost" disabled={state.busy} onClick={() => void api(`/grading-suggestions/${s.id}/reject`, { method: 'POST' }).then(load).catch((err) => setState({ error: errorMessage(err) }))}>
                      Reject
                    </Button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Families: parent emails and narratives
// ---------------------------------------------------------------------------

function Families({ classes }: { classes: ClassItem[] }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [email, setEmail] = useState({ studentId: '', purpose: 'share good news from this week', tone: 'warm and specific', language: 'en' });
  const [narrative, setNarrative] = useState({ studentId: '', classId: '' });
  const [state, setState] = useState<Busy>({});
  useEffect(() => {
    api<Paged<Student>>('/students?pageSize=200&sort=lastName,firstName').then((r) => setStudents(r.data)).catch(() => setStudents([]));
  }, []);
  const load = useCallback(async () => {
    try {
      setDrafts((await api<{ data: Draft[] }>('/assistant/drafts')).data.filter((d) => d.kind === 'parent_email' || d.kind === 'narrative'));
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function run(path: string, body: Record<string, unknown>, ok: string) {
    setState({ busy: true });
    try {
      const job = await api<{ id: string }>(path, { method: 'POST', body });
      await waitForJob(job.id);
      await load();
      setState({ ok });
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  return (
    <>
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Email a family" description="Drafted from this student's own numbers only, in the family's language. You read and edit it, then it goes as a message to the guardians.">
          <div className="space-y-3">
            <Select label="Student" value={email.studentId} onChange={(e) => setEmail({ ...email, studentId: e.target.value })}>
              <option value="">Choose</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.lastName}, {s.firstName}
                </option>
              ))}
            </Select>
            <Input label="Purpose" value={email.purpose} onChange={(e) => setEmail({ ...email, purpose: e.target.value })} />
            <div className="grid gap-3 md:grid-cols-2">
              <Input label="Tone" value={email.tone} onChange={(e) => setEmail({ ...email, tone: e.target.value })} />
              <Select label="Language" value={email.language} onChange={(e) => setEmail({ ...email, language: e.target.value })}>
                <option value="en">English</option>
                <option value="es">Spanish</option>
              </Select>
            </div>
            <Button loading={state.busy} disabled={!email.studentId || email.purpose.trim().length < 3} onClick={() => void run('/assistant/drafts/parent-email', email, 'Email drafted. Read it below before sending.')}>
              Draft email
            </Button>
          </div>
        </Card>
        <Card title="Progress narrative" description="A report-card comment drafted from the student's grades, attendance and notes in that class. Apply it to their draft report card when you are happy with it.">
          <div className="space-y-3">
            <Select label="Student" value={narrative.studentId} onChange={(e) => setNarrative({ ...narrative, studentId: e.target.value })}>
              <option value="">Choose</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.lastName}, {s.firstName}
                </option>
              ))}
            </Select>
            <Select label="Class" value={narrative.classId} onChange={(e) => setNarrative({ ...narrative, classId: e.target.value })}>
              <option value="">Choose</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <div className="flex flex-wrap gap-2">
              <Button loading={state.busy} disabled={!narrative.studentId || !narrative.classId} onClick={() => void run('/assistant/drafts/narrative', narrative, 'Narrative drafted.')}>
                Draft narrative
              </Button>
              <Button variant="secondary" loading={state.busy} disabled={!narrative.classId} onClick={() => void run('/assistant/drafts/narratives', { classId: narrative.classId }, 'Narratives drafted for the whole class.')}>
                Draft for the whole class
              </Button>
            </div>
          </div>
        </Card>
      </div>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}
      <Card title="Drafts" description="Private to you until you send or apply them.">
        {drafts === null && <SkeletonRows rows={3} />}
        {drafts && drafts.length === 0 && <p className="text-sm text-slate-500">No drafts yet.</p>}
        <div className="space-y-4">
          {(drafts ?? []).map((d) => (
            <DraftCard key={d.id} draft={d} onChanged={load} onMessage={setState} />
          ))}
        </div>
      </Card>
    </>
  );
}

function DraftCard({ draft, onChanged, onMessage }: { draft: Draft; onChanged: () => Promise<void>; onMessage: (s: Busy) => void }) {
  const [content, setContent] = useState<Record<string, unknown>>(draft.content);
  const [busy, setBusy] = useState(false);
  const area = 'block w-full rounded-md border-0 px-3 py-2 text-sm shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500';
  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      onMessage({ ok });
      await onChanged();
    } catch (err) {
      onMessage({ error: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }
  const save = () => act(() => api(`/drafts/${draft.id}`, { method: 'PATCH', body: { content } }), 'Saved.');
  const email = content as EmailContent;
  const narrative = content as NarrativeContent;
  return (
    <article className="rounded-lg bg-slate-50 p-4 text-sm">
      <p className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-slate-500">
        <span>{draft.kind === 'parent_email' ? 'Parent email' : 'Narrative'}</span>
        {draft.studentName && <span className="normal-case tracking-normal text-slate-700">{draft.studentName}</span>}
        <span>{draft.language}</span>
        {draft.aiGenerated && <span className="rounded bg-brand-50 px-1.5 py-0.5 normal-case tracking-normal text-brand-800">AI draft</span>}
        <span className={`rounded px-1.5 py-0.5 normal-case tracking-normal ${draft.status === 'draft' ? 'bg-amber-100 text-amber-900' : 'bg-green-100 text-green-800'}`}>{draft.status}</span>
      </p>
      {draft.kind === 'parent_email' ? (
        <div className="mt-2 space-y-2">
          <Input label="Subject" value={email.subject ?? ''} onChange={(e) => setContent({ ...content, subject: e.target.value })} />
          <Input label="Greeting" value={email.greeting ?? ''} onChange={(e) => setContent({ ...content, greeting: e.target.value })} />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Body (blank line between paragraphs)</span>
            <textarea className={area} rows={6} value={(email.body ?? []).join('\n\n')} onChange={(e) => setContent({ ...content, body: e.target.value.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean) })} />
          </label>
          <div className="grid gap-2 md:grid-cols-2">
            <Input label="Closing" value={email.closing ?? ''} onChange={(e) => setContent({ ...content, closing: e.target.value })} />
            <Input label="Signature" value={email.signature ?? ''} onChange={(e) => setContent({ ...content, signature: e.target.value })} />
          </div>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Narrative</span>
            <textarea className={area} rows={4} value={narrative.narrative ?? ''} onChange={(e) => setContent({ ...content, narrative: e.target.value })} />
          </label>
          <p className="text-xs text-slate-500">
            {narrative.strengths?.length ? `Strengths: ${narrative.strengths.join(', ')}. ` : ''}
            {narrative.growthAreas?.length ? `To work on: ${narrative.growthAreas.join(', ')}. ` : ''}
            {narrative.nextSteps?.length ? `Next: ${narrative.nextSteps.join(' ')}` : ''}
          </p>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" loading={busy} onClick={() => void save()}>
          Save
        </Button>
        {draft.kind === 'parent_email' && draft.status === 'draft' && (
          <Button loading={busy} onClick={() => void act(async () => (await save(), api(`/drafts/${draft.id}/send`, { method: 'POST' })), 'Sent to the family as a message.')}>
            Send to family
          </Button>
        )}
        {draft.kind === 'narrative' && draft.status === 'draft' && (
          <Button loading={busy} onClick={() => void act(async () => (await save(), api(`/drafts/${draft.id}/apply-to-report-card`, { method: 'POST' })), 'Put on the draft report card.')}>
            Apply to report card
          </Button>
        )}
        <Button variant="ghost" disabled={busy} onClick={() => void act(() => api(`/drafts/${draft.id}`, { method: 'DELETE' }), 'Deleted.')}>
          Delete
        </Button>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Differentiation
// ---------------------------------------------------------------------------

function Differentiation() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState('');
  const [lessons, setLessons] = useState<Array<{ id: string; title: string }>>([]);
  const [lessonId, setLessonId] = useState('');
  const [language, setLanguage] = useState('en');
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [state, setState] = useState<Busy>({});
  useEffect(() => {
    api<Paged<Course>>('/courses?pageSize=100').then((r) => setCourses(r.data)).catch(() => setCourses([]));
  }, []);
  useEffect(() => {
    if (!courseId) return setLessons([]);
    api<CourseDetail>(`/courses/${courseId}`)
      .then((c) => setLessons(c.modules.flatMap((m) => m.lessons.map((l) => ({ id: l.id, title: `${m.title} · ${l.title}` })))))
      .catch(() => setLessons([]));
  }, [courseId]);
  const load = useCallback(async () => {
    try {
      setDrafts((await api<{ data: Draft[] }>('/assistant/drafts?kind=differentiation')).data);
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function draft() {
    setState({ busy: true });
    try {
      const job = await api<{ id: string }>('/assistant/drafts/differentiation', { method: 'POST', body: { lessonId, language } });
      await waitForJob(job.id);
      await load();
      setState({ ok: 'Three levels ready below.' });
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  return (
    <>
      <Card title="Three reading levels in one go" description="Pick a lesson with text. The AI keeps the facts and the goal and rewrites it for students who need support, at grade level, and as an extension. Create the three as unpublished lessons and publish the ones you want.">
        <div className="grid gap-3 md:grid-cols-4">
          <Select label="Course" value={courseId} onChange={(e) => (setCourseId(e.target.value), setLessonId(''))}>
            <option value="">Choose</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
          <div className="md:col-span-2">
            <Select label="Lesson" value={lessonId} onChange={(e) => setLessonId(e.target.value)} disabled={!courseId}>
              <option value="">Choose</option>
              {lessons.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </Select>
          </div>
          <Select label="Language" value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="en">English</option>
            <option value="es">Spanish</option>
          </Select>
        </div>
        <Button className="mt-3" loading={state.busy} disabled={!lessonId} onClick={() => void draft()}>
          Adapt to three levels
        </Button>
        {state.error && (
          <div className="mt-3">
            <Alert>{state.error}</Alert>
          </div>
        )}
        {state.ok && (
          <div className="mt-3">
            <Alert kind="success">{state.ok}</Alert>
          </div>
        )}
      </Card>
      {drafts === null && <SkeletonRows rows={2} />}
      {(drafts ?? []).map((d) => {
        const c = d.content as DifferentiationContent;
        return (
          <Card key={d.id} title={d.title} description={`${d.status === 'used' ? 'Lessons created' : 'AI draft'} · ${d.language}`} actions={<Button variant="ghost" onClick={() => void api(`/drafts/${d.id}`, { method: 'DELETE' }).then(load)}>Delete</Button>}>
            <div className="grid gap-3 md:grid-cols-3">
              {(c.levels ?? []).map((lv) => (
                <article key={lv.level} className="rounded-lg bg-slate-50 p-3 text-sm">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">
                    {lv.level}
                    {lv.readingLevel ? ` · ${lv.readingLevel}` : ''}
                  </p>
                  <p className="font-medium text-slate-900">{lv.title}</p>
                  <p className="mt-1 line-clamp-6 whitespace-pre-wrap text-slate-700">{lv.text}</p>
                  {lv.keyWords?.length ? <p className="mt-1 text-xs text-slate-500">Key words: {lv.keyWords.join(', ')}</p> : null}
                  {lv.questions?.length ? (
                    <ol className="mt-1 list-decimal pl-4 text-xs text-slate-600">
                      {lv.questions.map((q, i) => (
                        <li key={i}>{q.prompt}</li>
                      ))}
                    </ol>
                  ) : null}
                </article>
              ))}
            </div>
            {d.status === 'draft' && (
              <Button className="mt-3" variant="secondary" onClick={() => void api(`/drafts/${d.id}/create-lessons`, { method: 'POST' }).then(load).then(() => setState({ ok: 'Three unpublished lessons added next to the source. Publish the ones you want from the course page.' })).catch((err) => setState({ error: errorMessage(err) }))}>
                Create three lessons
              </Button>
            )}
          </Card>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Class insight
// ---------------------------------------------------------------------------

function ClassInsight({ classes }: { classes: ClassItem[] }) {
  const [classId, setClassId] = useState('');
  const [insight, setInsight] = useState<Insight | null | undefined>(undefined);
  const [state, setState] = useState<Busy>({});
  const load = useCallback(async () => {
    if (!classId) return setInsight(undefined);
    try {
      setInsight(await api<Insight | null>(`/assistant/classes/${classId}/insight`));
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, [classId]);
  useEffect(() => {
    void load();
  }, [load]);
  async function build() {
    setState({ busy: true });
    try {
      const r = await api<{ job: { id: string } }>(`/assistant/classes/${classId}/insight`, { method: 'POST' });
      await waitForJob(r.job.id);
      await load();
      setState({ ok: "This week's briefing is ready." });
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  async function practice() {
    if (!insight) return;
    setState({ busy: true });
    try {
      const job = await api<{ id: string }>(`/assistant/insights/${insight.id}/practice-set`, { method: 'POST', body: {} });
      const done = await waitForJob(job.id);
      const contentId = (done as unknown as { contentId?: string | null }).contentId ?? null;
      if (contentId) await api(`/assistant/insights/${insight.id}`, { method: 'PATCH', body: { practiceContentId: contentId } });
      await load();
      setState({ ok: 'Practice set ready in Interactive content; review it, then attach it to an assignment.' });
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  const d = insight?.data;
  return (
    <>
      <Card title="Where the class is stuck this week" description="Numbers come from the tutor's traces, missing work, scores and attendance; the AI only narrates them. Then make a short practice set on the stuck topic.">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[260px]">
            <Select label="Class" value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">Choose</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <Button onClick={() => void build()} loading={state.busy} disabled={!classId}>
            {insight ? 'Refresh this week' : 'Build this week'}
          </Button>
          {insight?.narrative && (
            <Button variant="secondary" onClick={() => void practice()} loading={state.busy}>
              Make a practice set
            </Button>
          )}
        </div>
        {state.error && (
          <div className="mt-3">
            <Alert>{state.error}</Alert>
          </div>
        )}
        {state.ok && (
          <div className="mt-3">
            <Alert kind="success">{state.ok}</Alert>
          </div>
        )}
      </Card>
      {classId && insight === null && <p className="text-sm text-slate-500">No briefing for this class yet.</p>}
      {insight && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card title={insight.narrative?.headline ?? 'Briefing'} description={`Week of ${insight.weekStart}${insight.aiGenerated ? ' · AI narration of the numbers on the right' : ''}`}>
            {insight.narrative ? (
              <>
                <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {(insight.narrative.observations ?? []).map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
                {(insight.narrative.actions ?? []).length > 0 && (
                  <>
                    <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">Try this week</p>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                      {insight.narrative.actions!.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </>
                )}
                {insight.narrative.caveats && <p className="mt-3 text-xs text-slate-500">{insight.narrative.caveats}</p>}
              </>
            ) : (
              <p className="text-sm text-slate-500">Narration pending.</p>
            )}
            {insight.practiceContentId && (
              <p className="mt-3 text-sm">
                <Link href={`/content/${insight.practiceContentId}`} className="text-brand-700 underline">
                  Open the practice set
                </Link>
              </p>
            )}
          </Card>
          <Card title="The numbers">
            {d && (
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-slate-500">Students</dt>
                <dd>{d.students}</dd>
                <dt className="text-slate-500">Used the tutor</dt>
                <dd>
                  {d.tutor?.studentsWhoUsedIt} · {d.tutor?.conversationsThisWeek} chats (last week {d.tutor?.conversationsLastWeek}) · {d.tutor?.refusals} refused
                </dd>
                <dt className="text-slate-500">Top tutor topics</dt>
                <dd>{d.tutor?.topTopics.length ? d.tutor.topTopics.map((t) => `${t.topic} (${t.conversations})`).join(', ') : '—'}</dd>
                <dt className="text-slate-500">Missing work</dt>
                <dd>
                  {d.work?.missingItems} items across {d.work?.assignmentsDueLast14Days} assignments
                </dd>
                <dt className="text-slate-500">Submissions this week</dt>
                <dd>{d.work?.submissionsThisWeek}</dd>
                <dt className="text-slate-500">Recent average</dt>
                <dd>{d.work?.averageScoreRecent === null || d.work?.averageScoreRecent === undefined ? '—' : `${d.work.averageScoreRecent}%`}</dd>
                <dt className="text-slate-500">Low-scoring</dt>
                <dd>{d.work?.lowScoringAssignments.length ? d.work.lowScoringAssignments.map((a) => `${a.title} ${a.average}%`).join(', ') : 'none'}</dd>
                <dt className="text-slate-500">Attendance</dt>
                <dd>{d.attendance?.presentRate === null || d.attendance?.presentRate === undefined ? '—' : `${d.attendance.presentRate}% present`}</dd>
                <dt className="text-slate-500">Class average</dt>
                <dd>{d.classAverage === null || d.classAverage === undefined ? '—' : `${d.classAverage}%`}</dd>
                <dt className="text-slate-500">Lessons finished</dt>
                <dd>{d.lessonsCompletedThisWeek}</dd>
              </dl>
            )}
          </Card>
        </div>
      )}
      <p className="text-xs text-slate-500">Last briefing: {insight ? fmtDate(insight.updatedAt) : '—'}</p>
    </>
  );
}
