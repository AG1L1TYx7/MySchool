'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { MotionItem, MotionList, SkeletonRows } from '@/components/motion';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { ApiError, api, errorMessage, tokenStore, tryRefresh, type ProblemDetails } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Standard, StandardSet } from '@/lib/gradebook';
import type { Paged } from '@/lib/students';

async function importCase(file: File, code: string): Promise<{ imported: number; skipped: number; name: string }> {
  if (!tokenStore.access) await tryRefresh();
  const form = new FormData();
  form.append('file', file);
  if (code) form.append('code', code);
  const send = () => fetch('/api/v1/standards/sets/import', { method: 'POST', headers: { authorization: `Bearer ${tokenStore.access ?? ''}`, 'x-requested-with': 'SmartSchool' }, body: form, credentials: 'same-origin' });
  let res = await send();
  if (res.status === 401 && (await tryRefresh())) res = await send();
  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const problem = (data ?? {}) as Partial<ProblemDetails>;
    throw new ApiError({ type: problem.type ?? 'about:blank', title: problem.title ?? res.statusText, status: problem.status ?? res.status, detail: problem.detail ?? 'The import failed.', code: problem.code ?? `http.${res.status}`, errors: problem.errors, traceId: problem.traceId });
  }
  return data as { imported: number; skipped: number; name: string };
}

/** The standards catalogue: shared sets (Common Core, NGSS) and the district's own, imported from CASE packages. */
export default function StandardsPage() {
  const { can } = useAuth();
  const allowed = can('standards.view');
  const manage = can('standards.manage');
  const [sets, setSets] = useState<StandardSet[] | null>(null);
  const [setId, setSetId] = useState('');
  const [search, setSearch] = useState('');
  const [grade, setGrade] = useState('');
  const [rows, setRows] = useState<Standard[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<{ error?: string; ok?: string; busy?: boolean }>({});
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState('');
  const [manual, setManual] = useState({ code: '', name: '', subject: '', jurisdiction: '' });

  const loadSets = useCallback(async () => {
    try {
      setSets((await api<{ data: StandardSet[] }>('/standards/sets')).data);
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, []);
  useEffect(() => {
    if (allowed) void loadSets();
  }, [allowed, loadSets]);
  useEffect(() => {
    if (!allowed) return;
    const params = new URLSearchParams({ pageSize: '50' });
    if (setId) params.set('setId', setId);
    if (search.trim()) params.set('search', search.trim());
    if (grade) params.set('gradeLevel', grade);
    const t = setTimeout(() => {
      api<Paged<Standard>>(`/standards?${params.toString()}`)
        .then((r) => {
          setRows(r.data);
          setTotal(r.meta.totalItems);
        })
        .catch((err) => setState({ error: errorMessage(err) }));
    }, 200);
    return () => clearTimeout(t);
  }, [allowed, setId, search, grade]);

  if (!allowed) return <NotForYou what="the standards catalogue" back="/dashboard" />;

  async function doImport(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setState({ busy: true });
    try {
      const r = await importCase(file, code);
      setState({ ok: `${r.name}: ${r.imported} standards imported${r.skipped ? `, ${r.skipped} already present` : ''}.` });
      setFile(null);
      setCode('');
      await loadSets();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  async function createSet(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      await api('/standards/sets', { method: 'POST', body: { code: manual.code, name: manual.name, subject: manual.subject || undefined, jurisdiction: manual.jurisdiction || undefined } });
      setState({ ok: 'Set created. Add standards to it from the API or import a CASE file with the same code.' });
      setManual({ code: '', name: '', subject: '', jurisdiction: '' });
      await loadSets();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Standards</h1>
        <p className="text-sm text-slate-500">Common Core, NGSS and state sets to tag on lessons and assignments. Shared sets come with SmartSchool; districts add their own.</p>
      </div>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}

      <Card title="Sets" description={sets ? `${sets.length} set${sets.length === 1 ? '' : 's'} available.` : undefined}>
        {!sets && <SkeletonRows rows={3} />}
        <MotionList className="divide-y divide-slate-100">
          {(sets ?? []).map((s) => (
            <MotionItem key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div>
                <button type="button" className="font-medium text-slate-900 hover:underline" onClick={() => setSetId(s.id)}>
                  {s.name}
                </button>
                <p className="text-xs text-slate-500">
                  <span className="font-mono">{s.code}</span>
                  {s.subject ? ` · ${s.subject}` : ''}
                  {s.jurisdiction ? ` · ${s.jurisdiction}` : ''} · {s.standardCount} standard{s.standardCount === 1 ? '' : 's'}
                  {s.shared ? ' · shared' : ' · this district'}
                </p>
              </div>
              {manage && !s.shared && (
                <button type="button" className="text-xs text-slate-500 hover:text-red-700" disabled={state.busy} onClick={() => void api(`/standards/sets/${s.id}`, { method: 'DELETE' }).then(loadSets).catch((err) => setState({ error: errorMessage(err) }))}>
                  Remove
                </button>
              )}
            </MotionItem>
          ))}
        </MotionList>
      </Card>

      {manage && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card title="Import a CASE package" description="The JSON format Common Core, NGSS and most state frameworks publish (1EdTech CASE). Re-importing adds only what is new.">
            <form onSubmit={doImport} className="space-y-3" noValidate>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">CASE JSON file</span>
                <input type="file" accept="application/json,.json" className="block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
              <Input label="Set code (optional)" placeholder="TEKS-SCI" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
              <Button type="submit" loading={state.busy} disabled={!file}>
                Import
              </Button>
            </form>
          </Card>
          <Card title="Create an empty set" description="For a district's own learning targets.">
            <form onSubmit={createSet} className="space-y-3" noValidate>
              <Input label="Code" required placeholder="LINCOLN-SEL" value={manual.code} onChange={(e) => setManual({ ...manual, code: e.target.value.toUpperCase() })} />
              <Input label="Name" required value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} />
              <div className="grid gap-3 md:grid-cols-2">
                <Input label="Subject" value={manual.subject} onChange={(e) => setManual({ ...manual, subject: e.target.value })} />
                <Input label="Jurisdiction" value={manual.jurisdiction} onChange={(e) => setManual({ ...manual, jurisdiction: e.target.value })} />
              </div>
              <Button type="submit" variant="secondary" loading={state.busy} disabled={!manual.code || !manual.name}>
                Create set
              </Button>
            </form>
          </Card>
        </div>
      )}

      <Card title="Browse" description={`${total} matching standard${total === 1 ? '' : 's'}${total > rows.length ? `, showing ${rows.length}` : ''}.`}>
        <div className="mb-3 grid gap-3 md:grid-cols-3">
          <Select label="Set" value={setId} onChange={(e) => setSetId(e.target.value)}>
            <option value="">All sets</option>
            {(sets ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.code}
              </option>
            ))}
          </Select>
          <Input label="Grade" placeholder="7" value={grade} onChange={(e) => setGrade(e.target.value)} />
          <Input label="Search" placeholder="Code or words" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.map((s) => (
            <li key={s.id} className="flex flex-wrap gap-3 py-2">
              <span className="w-full font-mono text-xs text-slate-700 sm:w-56 sm:shrink-0">
                {s.code}
                {s.setCode ? <span className="block text-slate-500">{s.setCode}</span> : null}
              </span>
              <span className="min-w-0 flex-1 text-slate-700">{s.description}</span>
              {s.gradeLevels.length > 0 && <span className="text-xs text-slate-500">Grade {s.gradeLevels.join(', ')}</span>}
            </li>
          ))}
          {rows.length === 0 && <li className="py-4 text-center text-slate-500">No standards match.</li>}
        </ul>
      </Card>
    </div>
  );
}
