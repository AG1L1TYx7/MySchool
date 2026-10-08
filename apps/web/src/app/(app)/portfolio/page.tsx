'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { CareerPanel, ProjectCard, SkillsCard } from '@/components/careers-cards';
import { PillGroup, SkeletonRows } from '@/components/motion';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, download, errorMessage, upload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { KIND_LABELS, VISIBILITY_LABELS, type Career, type Evidence, type Portfolio, type PortfolioVisibility, type ProjectKind, type SkillDef } from '@/lib/careers';

type Tab = 'projects' | 'skills' | 'career';
const TABS: readonly Tab[] = ['projects', 'skills', 'career'];
const TAB_LABELS: Record<Tab, string> = { projects: 'Projects', skills: 'Skills', career: 'Career and college' };

/** A student's own portfolio, skills and career page (docs/02 sections 28 and 34). */
export default function PortfolioPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={4} />}>
      <PortfolioHome />
    </Suspense>
  );
}

function PortfolioHome() {
  const { user, can } = useAuth();
  const params = useSearchParams();
  const raw = params.get('tab');
  const [tab, setTabState] = useState<Tab>((TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'projects');
  const setTab = (t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, '', t === 'projects' ? '/portfolio' : `/portfolio?tab=${t}`);
  };
  const isStudent = user?.role === 'student';
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [career, setCareer] = useState<Career | null>(null);
  const [catalogue, setCatalogue] = useState<SkillDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!isStudent) return;
    api<Portfolio>('/me/portfolio').then(setPortfolio).catch((e) => setError(errorMessage(e)));
    api<Career>('/me/career').then(setCareer).catch((e) => setError(errorMessage(e)));
    api<SkillDef[]>('/skills').then(setCatalogue).catch(() => setCatalogue([]));
  }, [isStudent]);
  useEffect(load, [load]);
  if (!can('portfolio.view') || !isStudent) return <NotForYou what="your portfolio" back="/dashboard" />;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">My portfolio</h1>
          <p className="mt-1 text-sm text-slate-600">Work you are proud of, the skills behind it, and where you are heading. Your resume is built from all of it.</p>
        </div>
        {portfolio && (
          <Button variant="secondary" onClick={() => void download(`/students/${portfolio.studentId}/resume.pdf`, `resume-${portfolio.student.lastName.toLowerCase()}-${portfolio.student.firstName.toLowerCase()}.pdf`)}>
            Download my resume
          </Button>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
      <PillGroup name="portfolio-tab" options={TABS} value={tab} onChange={setTab} labels={(v) => TAB_LABELS[v]} />
      {!portfolio ? <SkeletonRows rows={4} /> : tab === 'projects' ? <ProjectsView portfolio={portfolio} onChange={load} /> : tab === 'skills' ? <SkillsCard portfolio={portfolio} catalogue={catalogue} onChange={load} /> : career ? <CareerPanel career={career} onChange={load} /> : <SkeletonRows rows={4} />}
    </div>
  );
}

function ProjectsView({ portfolio, onChange }: { portfolio: Portfolio; onChange: () => void }) {
  const [headline, setHeadline] = useState(portfolio.headline ?? '');
  const [about, setAbout] = useState(portfolio.about ?? '');
  const [visibility, setVisibility] = useState<PortfolioVisibility>(portfolio.visibility);
  const [form, setForm] = useState({ title: '', summary: '', description: '', kind: 'project' as ProjectKind, skills: '', externalUrl: '', completedOn: '', sourceSubmissionId: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    api<Evidence[]>('/me/portfolio/evidence').then(setEvidence).catch(() => setEvidence([]));
  }, []);
  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('profile');
    setError(null);
    setNote(null);
    try {
      const p = await api<Portfolio>('/me/portfolio', { method: 'PATCH', body: { headline, about, visibility } });
      setNote(p.publicPath ? `Saved. Your public page is at ${window.location.origin}${p.publicPath}` : 'Saved.');
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  const addProject = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('project');
    setError(null);
    setNote(null);
    try {
      const fileIds: string[] = [];
      for (const f of files) fileIds.push((await upload<{ id: string }>('/files', f)).id);
      await api('/me/portfolio/projects', { method: 'POST', body: { title: form.title, summary: form.summary || undefined, description: form.description || undefined, kind: form.kind, skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean), externalUrl: form.externalUrl || undefined, completedOn: form.completedOn || undefined, sourceSubmissionId: form.sourceSubmissionId || undefined, fileIds } });
      setForm({ ...form, title: '', summary: '', description: '', skills: '', externalUrl: '', completedOn: '', sourceSubmissionId: '' });
      setFiles([]);
      setNote('Added as a draft. Publish it when it is ready.');
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      {note && <Alert kind="success">{note}</Alert>}
      <Card title="About me and who can see this" description="Private portfolios are still visible to your family, your teachers and your counselor. A public page shows only published projects, never your grades.">
        <form onSubmit={saveProfile} className="space-y-3">
          <Input label="Headline" id="pf-headline" value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Curious builder who likes bridges and code" />
          <Input label="About" id="pf-about" value={about} onChange={(e) => setAbout(e.target.value)} />
          <Select label="Who can see it" id="pf-visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as PortfolioVisibility)}>
            {(Object.keys(VISIBILITY_LABELS) as PortfolioVisibility[]).map((v) => (
              <option key={v} value={v}>
                {VISIBILITY_LABELS[v]}
              </option>
            ))}
          </Select>
          {portfolio.publicPath && (
            <p className="text-sm">
              Public page:{' '}
              <Link href={portfolio.publicPath} className="text-brand-700 hover:underline">
                {portfolio.publicPath}
              </Link>
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" variant="secondary" loading={busy === 'profile'}>
              Save
            </Button>
          </div>
        </form>
      </Card>
      <Card title="Add a project" description="Anything you made or did: a report, a build, a performance, a service day. Attach files, link a school submission as evidence, and name the skills it shows.">
        <form onSubmit={addProject} className="grid gap-3 sm:grid-cols-2">
          <Input label="Title" id="pj-title" required minLength={2} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Select label="Kind" id="pj-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ProjectKind })}>
            {(Object.keys(KIND_LABELS) as ProjectKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </Select>
          <div className="sm:col-span-2">
            <Input label="One-line summary" id="pj-summary" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Input label="Description" id="pj-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <Input label="Skills it shows (comma separated)" id="pj-skills" value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} />
          <Input label="Finished on" id="pj-date" type="date" value={form.completedOn} onChange={(e) => setForm({ ...form, completedOn: e.target.value })} />
          <Input label="Link (optional)" id="pj-url" type="url" value={form.externalUrl} onChange={(e) => setForm({ ...form, externalUrl: e.target.value })} />
          <Select label="School work as evidence (optional)" id="pj-evidence" value={form.sourceSubmissionId} onChange={(e) => setForm({ ...form, sourceSubmissionId: e.target.value })}>
            <option value="">None</option>
            {evidence.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.title} ({ev.className}){ev.grade?.letter ? ` · ${ev.grade.letter}` : ''}
              </option>
            ))}
          </Select>
          <div className="sm:col-span-2">
            <label htmlFor="pj-files" className="block text-sm font-medium text-slate-700">
              Files (optional)
            </label>
            <input id="pj-files" type="file" multiple className="mt-1 block w-full text-sm" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          </div>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" loading={busy === 'project'}>
              Add project
            </Button>
          </div>
        </form>
      </Card>
      {portfolio.projects.length === 0 ? <p className="text-sm text-slate-600">No projects yet.</p> : portfolio.projects.map((p) => <ProjectCard key={p.id} project={p} own canReview={false} onChange={onChange} />)}
    </div>
  );
}
