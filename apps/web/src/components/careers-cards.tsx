'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { MotionItem, MotionList, SkeletonRows } from '@/components/motion';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, download, errorMessage } from '@/lib/api';
import { KIND_LABELS, LEVEL_LABELS, PLAN_STATUSES, type Career, type Cluster, type Inventory, type Portfolio, type Project, type SkillDef } from '@/lib/careers';

/** One project, as its owner, a reader or a reviewer sees it. */
export function ProjectCard({ project, own, canReview, onChange }: { project: Project; own: boolean; canReview: boolean; onChange: () => void }) {
  const [comment, setComment] = useState('');
  const [stars, setStars] = useState(5);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <Card title={project.title} description={`${KIND_LABELS[project.kind]} · ${project.status}${project.featured ? ' · featured' : ''}${project.completedOn ? ` · ${new Date(project.completedOn).toLocaleDateString()}` : ''}`}>
      {error && <Alert>{error}</Alert>}
      {project.summary && <p className="text-sm">{project.summary}</p>}
      {project.description && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{project.description}</p>}
      {project.skills.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {project.skills.map((s) => (
            <li key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
              {s}
            </li>
          ))}
        </ul>
      )}
      {project.evidence && <p className="mt-2 text-xs text-slate-600">Evidence: {project.evidence.title} (school submission)</p>}
      {project.externalUrl && (
        <a href={project.externalUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-brand-700 hover:underline">
          Open the link
        </a>
      )}
      {project.media.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {project.media.map((m) => (
            <li key={m.id}>
              <button type="button" className="text-brand-700 hover:underline" onClick={() => void download(`/files/${m.fileId}/download`, m.name)}>
                {m.name}
              </button>
              {m.caption ? ` · ${m.caption}` : ''}
            </li>
          ))}
        </ul>
      )}
      {project.reflection && own && <p className="mt-2 text-xs text-slate-600">Reflection: {project.reflection}</p>}
      {project.reviews.length > 0 && (
        <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm">
          {project.reviews.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-2">
              <span>
                <span className="font-medium">{r.by}</span> <span className="text-xs text-slate-600">({r.role})</span>
                {r.stars ? <span className="text-xs text-slate-600"> · {r.stars} of 5</span> : null}: {r.comment}
              </span>
              {own && (
                <Button variant="ghost" loading={busy === r.id} onClick={() => void run(r.id, async () => void (await api(`/me/portfolio/projects/${project.id}/reviews/${r.id}/hide`, { method: 'POST' })))}>
                  Hide
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canReview && project.status === 'published' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run('review', async () => {
              await api(`/portfolio/projects/${project.id}/reviews`, { method: 'POST', body: { comment, stars } });
              setComment('');
            });
          }}
          className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3"
        >
          <Input label="Feedback" id={`review-${project.id}`} required minLength={2} value={comment} onChange={(e) => setComment(e.target.value)} />
          <Select label="Stars" id={`stars-${project.id}`} value={stars} onChange={(e) => setStars(Number(e.target.value))}>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary" loading={busy === 'review'}>
            Send
          </Button>
        </form>
      )}
      {own && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" loading={busy === 'status'} onClick={() => void run('status', async () => void (await api(`/me/portfolio/projects/${project.id}`, { method: 'PATCH', body: { status: project.status === 'published' ? 'draft' : 'published' } })))}>
            {project.status === 'published' ? 'Unpublish' : 'Publish'}
          </Button>
          <Button variant="secondary" loading={busy === 'feature'} onClick={() => void run('feature', async () => void (await api(`/me/portfolio/projects/${project.id}`, { method: 'PATCH', body: { featured: !project.featured } })))}>
            {project.featured ? 'Unfeature' : 'Feature'}
          </Button>
          <Button variant="danger" loading={busy === 'delete'} onClick={() => void run('delete', async () => void (await api(`/me/portfolio/projects/${project.id}`, { method: 'DELETE' })))}>
            Delete
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Skills with levels and endorsements; readers who may endorse get a button. */
export function SkillsCard({ portfolio, catalogue, onChange }: { portfolio: Portfolio; catalogue: SkillDef[]; onChange: () => void }) {
  const [skillId, setSkillId] = useState('');
  const [level, setLevel] = useState(2);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <Card title="Skills" description={portfolio.own ? 'Rate yourself honestly. Teachers and classmates can endorse a skill they have seen.' : 'Endorse a skill you have seen this student use.'}>
      {error && <Alert>{error}</Alert>}
      {portfolio.own && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run('add', async () => void (await api('/me/skills', { method: 'PUT', body: { skillId, level } })));
          }}
          className="mb-3 flex flex-wrap items-end gap-2"
        >
          <Select label="Skill" id="skill-pick" required value={skillId} onChange={(e) => setSkillId(e.target.value)}>
            <option value="">Choose</option>
            {catalogue.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.category})
              </option>
            ))}
          </Select>
          <Select label="Level" id="skill-level" value={level} onChange={(e) => setLevel(Number(e.target.value))}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {LEVEL_LABELS[n]}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary" loading={busy === 'add'}>
            Add or update
          </Button>
        </form>
      )}
      {portfolio.skills.length === 0 ? (
        <p className="text-sm text-slate-600">No skills yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {portfolio.skills.map((s) => (
            <li key={s.skillId} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <div className="min-w-0">
                <span className="font-medium">{s.name}</span> <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{LEVEL_LABELS[s.level]}</span>
                {s.note && <p className="text-xs text-slate-600">{s.note}</p>}
                {s.endorsements.length > 0 && (
                  <p className="text-xs text-emerald-700">
                    {s.endorsements.length} endorsement{s.endorsements.length === 1 ? '' : 's'}: {s.endorsements.map((e) => e.by).join(', ')}
                  </p>
                )}
              </div>
              <div className="flex gap-1">
                {!portfolio.own && portfolio.canReview && (
                  <Button variant="secondary" loading={busy === s.skillId} onClick={() => void run(s.skillId, async () => void (await api(`/students/${portfolio.studentId}/skills/${s.skillId}/endorse`, { method: 'POST', body: {} })))}>
                    Endorse
                  </Button>
                )}
                {portfolio.own && (
                  <Button variant="ghost" loading={busy === s.skillId} onClick={() => void run(s.skillId, async () => void (await api(`/me/skills/${s.skillId}`, { method: 'DELETE' })))}>
                    Remove
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The interest inventory form; eighteen statements on a five-point scale. */
export function InventoryForm({ onDone }: { onDone: () => void }) {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Inventory>('/career/inventory').then(setInv).catch((e) => setError(errorMessage(e)));
  }, []);
  if (error) return <Alert>{error}</Alert>;
  if (!inv) return <SkeletonRows rows={4} />;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/me/career/inventory', { method: 'POST', body: { answers } });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-slate-600">For each statement, pick from 1 (not me) to 5 (very much me). There are no wrong answers; the result points at career clusters worth a look.</p>
      <ol className="space-y-2">
        {inv.questions.map((q, i) => (
          <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-2 text-sm ring-1 ring-slate-200">
            <span>
              {i + 1}. {q.text}
            </span>
            <span className="flex gap-1" role="radiogroup" aria-label={q.text}>
              {inv.scale.map((n) => (
                <button key={n} type="button" role="radio" aria-checked={answers[q.id] === n} className={`h-8 w-8 rounded-full text-xs ${answers[q.id] === n ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => setAnswers({ ...answers, [q.id]: n })}>
                  {n}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ol>
      <div className="flex justify-end">
        <Button type="submit" loading={busy} disabled={Object.keys(answers).length < inv.questions.length}>
          See my results
        </Button>
      </div>
    </form>
  );
}

/** Career and college readiness: results, pathways, college plans and the checklist; counselors tick their items. */
export function CareerPanel({ career, onChange }: { career: Career; onChange: () => void }) {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [goals, setGoals] = useState(career.goals ?? '');
  const [pathways, setPathways] = useState<string[]>(career.pathways.map((p) => p.id));
  const [plans, setPlans] = useState(career.collegePlans);
  const [showInventory, setShowInventory] = useState(!career.interests);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    api<Cluster[]>('/career/clusters').then(setClusters).catch(() => setClusters([]));
  }, []);
  const canEdit = career.own || career.canCounsel;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('save');
    setError(null);
    setNote(null);
    try {
      await api(`/students/${career.student.id}/career`, { method: 'PATCH', body: { goals, pathways, collegePlans: plans } });
      setNote('Saved.');
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  const tick = async (key: string, done: boolean) => {
    setBusy(key);
    setError(null);
    try {
      await api(`/students/${career.student.id}/career/checklist`, { method: 'POST', body: { key, done } });
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  const togglePathway = (id: string) => setPathways(pathways.includes(id) ? pathways.filter((p) => p !== id) : pathways.length < 6 ? [...pathways, id] : pathways);
  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      {note && <Alert kind="success">{note}</Alert>}
      <Card title="Interests" description={career.interests ? `Taken ${career.interests.takenAt ? new Date(career.interests.takenAt).toLocaleDateString() : ''}. Your code is ${career.interests.code}: ${career.interests.names.join(', ')}.` : 'A short inventory that points at career clusters worth exploring.'}>
        {career.interests && !showInventory ? (
          <div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {career.interests.clusters.map((c) => (
                <li key={c.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-slate-600">For example: {c.examples.join(', ')}</p>
                </li>
              ))}
            </ul>
            {career.own && (
              <Button variant="ghost" onClick={() => setShowInventory(true)}>
                Take it again
              </Button>
            )}
          </div>
        ) : career.own ? (
          <InventoryForm
            onDone={() => {
              setShowInventory(false);
              onChange();
            }}
          />
        ) : (
          <p className="text-sm text-slate-600">Not taken yet.</p>
        )}
      </Card>
      <Card title="Goals, pathways and college plans" description="Pick up to six career clusters to explore and keep a list of colleges or training programmes with where each one stands.">
        <form onSubmit={save} className="space-y-3">
          <Input label="Goals" id="career-goals" value={goals} disabled={!canEdit} onChange={(e) => setGoals(e.target.value)} placeholder="What I want to be doing in five years" />
          <fieldset>
            <legend className="text-sm font-medium">Pathways to explore</legend>
            <ul className="mt-1 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {clusters.map((c) => (
                <li key={c.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" disabled={!canEdit} checked={pathways.includes(c.id)} onChange={() => togglePathway(c.id)} />
                    {c.name}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-medium">College and training list</legend>
            <ul className="mt-1 space-y-2">
              {plans.map((p, i) => (
                <li key={i} className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                  <Input label="Name" id={`plan-name-${i}`} value={p.name} disabled={!canEdit} onChange={(e) => setPlans(plans.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <Select label="Status" id={`plan-status-${i}`} value={p.status} disabled={!canEdit} onChange={(e) => setPlans(plans.map((x, j) => (j === i ? { ...x, status: e.target.value } : x)))}>
                    {PLAN_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                  {canEdit && (
                    <div className="flex items-end">
                      <Button type="button" variant="ghost" onClick={() => setPlans(plans.filter((_, j) => j !== i))}>
                        Remove
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && (
              <Button type="button" variant="ghost" onClick={() => setPlans([...plans, { name: '', status: 'interested' }])}>
                Add a college or programme
              </Button>
            )}
          </fieldset>
          {canEdit && (
            <div className="flex justify-end">
              <Button type="submit" loading={busy === 'save'}>
                Save
              </Button>
            </div>
          )}
        </form>
      </Card>
      <Card title={`Readiness checklist: ${career.readiness}%`} description="What to have done by now for this grade. Students tick their own items; the counselor ticks the counselor items.">
        <MotionList className="space-y-1">
          {career.checklist.map((i) => {
            const mayTick = (career.own && i.who === 'student') || career.canCounsel;
            return (
              <MotionItem key={i.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-2 text-sm ring-1 ring-slate-200">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={i.done} disabled={!mayTick || busy === i.key} onChange={(e) => void tick(i.key, e.target.checked)} />
                  <span className={i.done ? 'line-through text-slate-500' : ''}>{i.label}</span>
                </label>
                <span className="text-xs text-slate-600">{i.who === 'counselor' ? 'counselor' : 'student'}</span>
              </MotionItem>
            );
          })}
        </MotionList>
      </Card>
    </div>
  );
}

/** Staff view on a student's page: the portfolio (if shared with them), skills to endorse, the resume and the career panel for counselors. */
export function StudentCareersCard({ studentId, canCounsel }: { studentId: string; canCounsel: boolean }) {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [career, setCareer] = useState<Career | null>(null);
  const [catalogue, setCatalogue] = useState<SkillDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Portfolio>(`/students/${studentId}/portfolio`).then(setPortfolio).catch((e) => setError(errorMessage(e)));
    api<SkillDef[]>('/skills').then(setCatalogue).catch(() => setCatalogue([]));
    if (canCounsel) api<Career>(`/students/${studentId}/career`).then(setCareer).catch(() => setCareer(null));
  }, [studentId, canCounsel]);
  useEffect(load, [load]);
  if (error) return <Alert kind="info">{error}</Alert>;
  if (!portfolio) return <SkeletonRows rows={3} />;
  return (
    <div className="space-y-4">
      <Card title="Portfolio" description={`${portfolio.projects.length} project${portfolio.projects.length === 1 ? '' : 's'} · shared with ${portfolio.visibility}`} actions={<Button variant="secondary" onClick={() => void download(`/students/${studentId}/resume.pdf`, `resume-${portfolio.student.lastName}.pdf`)}>Resume PDF</Button>}>
        {portfolio.headline && <p className="text-sm font-medium">{portfolio.headline}</p>}
        {portfolio.publicPath && (
          <Link href={portfolio.publicPath} className="text-sm text-brand-700 hover:underline">
            Public page
          </Link>
        )}
      </Card>
      {portfolio.projects.map((p) => (
        <ProjectCard key={p.id} project={p} own={false} canReview={portfolio.canReview} onChange={load} />
      ))}
      <SkillsCard portfolio={portfolio} catalogue={catalogue} onChange={load} />
      {career && <CareerPanel career={career} onChange={load} />}
    </div>
  );
}
