'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { MotionItem, MotionList, SkeletonRows } from '@/components/motion';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { ClassGrading, ProficiencyScale } from '@/lib/gradebook';

/** Teacher card on the class page: grading mode, weighted categories, late policy and syllabus. */
export function GradingSettings({ classId, organizationId }: { classId: string; organizationId: string }) {
  const [grading, setGrading] = useState<ClassGrading | null>(null);
  const [scales, setScales] = useState<ProficiencyScale[]>([]);
  const [state, setState] = useState<{ error?: string; ok?: string; busy?: boolean }>({});
  const [form, setForm] = useState({ gradingMode: 'points', proficiencyScaleId: '', latePolicy: '', syllabus: '' });
  const [cat, setCat] = useState({ name: '', weight: '', dropLowest: '0' });

  const load = useCallback(async () => {
    try {
      const [g, s] = await Promise.all([api<ClassGrading>(`/classes/${classId}/grading`), api<{ data: ProficiencyScale[] }>(`/organizations/${organizationId}/proficiency-scales`).catch(() => ({ data: [] as ProficiencyScale[] }))]);
      setGrading(g);
      setScales(s.data);
      setForm({ gradingMode: g.gradingMode, proficiencyScaleId: g.proficiencyScaleId ?? '', latePolicy: g.latePolicy ?? '', syllabus: g.syllabus ?? '' });
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, [classId, organizationId]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setState({ busy: true });
    try {
      await fn();
      setState({ ok });
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  };

  if (!grading) {
    return (
      <Card title="Grading">
        {state.error ? <Alert>{state.error}</Alert> : <SkeletonRows rows={3} />}
      </Card>
    );
  }
  const total = grading.categories.reduce((s, c) => s + c.weight, 0);

  return (
    <Card title="Grading" description="How the final grade is worked out, and what students and parents see about late work.">
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}
      <form
        className="grid gap-3 md:grid-cols-2"
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void run(() => api(`/classes/${classId}/grading`, { method: 'PUT', body: { gradingMode: form.gradingMode, proficiencyScaleId: form.proficiencyScaleId || null, latePolicy: form.latePolicy, syllabus: form.syllabus } }), 'Grading settings saved.');
        }}
      >
        <Select label="Grading" value={form.gradingMode} onChange={(e) => setForm({ ...form, gradingMode: e.target.value })}>
          <option value="points">Points and letters</option>
          <option value="standards">Standards-based (proficiency levels)</option>
        </Select>
        <Select label="Proficiency scale" value={form.proficiencyScaleId} onChange={(e) => setForm({ ...form, proficiencyScaleId: e.target.value })} disabled={form.gradingMode !== 'standards'}>
          <option value="">School default</option>
          {scales.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.levels.map((l) => l.label).join(', ')})
            </option>
          ))}
        </Select>
        <label className="block md:col-span-2">
          <span className="mb-1 block text-sm font-medium text-slate-700">Late work policy (shown to students and parents)</span>
          <textarea className="block w-full rounded-md border-0 px-3 py-2 text-sm shadow-sm ring-1 ring-inset ring-slate-300" rows={2} value={form.latePolicy} onChange={(e) => setForm({ ...form, latePolicy: e.target.value })} />
        </label>
        <label className="block md:col-span-2">
          <span className="mb-1 block text-sm font-medium text-slate-700">Syllabus</span>
          <textarea className="block w-full rounded-md border-0 px-3 py-2 text-sm shadow-sm ring-1 ring-inset ring-slate-300" rows={4} value={form.syllabus} onChange={(e) => setForm({ ...form, syllabus: e.target.value })} />
        </label>
        <div className="md:col-span-2">
          <Button type="submit" loading={state.busy}>
            Save grading settings
          </Button>
        </div>
      </form>

      <h3 className="mt-6 text-sm font-semibold text-slate-900">Weighted categories</h3>
      <p className="mb-2 text-xs text-slate-500">Weights are percentages of the final grade. Drop-lowest leaves out that many of a student&apos;s lowest scores in the category. With no categories, every assignment counts by its points.</p>
      {grading.weightWarning && <Alert kind="info">{grading.weightWarning}</Alert>}
      <MotionList className="mt-2 divide-y divide-slate-100">
        {grading.categories.map((c) => (
          <MotionItem key={c.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
            <span className="w-40 font-medium text-slate-800">{c.name}</span>
            <label className="flex items-center gap-1 text-xs text-slate-600">
              Weight
              <input type="number" min="0" max="100" step="1" className="w-16 rounded-md border-0 py-1 text-sm ring-1 ring-inset ring-slate-300" defaultValue={c.weight} aria-label={`${c.name} weight`} onBlur={(e) => Number(e.target.value) !== c.weight && void run(() => api(`/classes/${classId}/grading/categories/${c.id}`, { method: 'PATCH', body: { weight: Number(e.target.value) } }), `${c.name} weight updated.`)} />
              %
            </label>
            <label className="flex items-center gap-1 text-xs text-slate-600">
              Drop lowest
              <input type="number" min="0" max="10" className="w-14 rounded-md border-0 py-1 text-sm ring-1 ring-inset ring-slate-300" defaultValue={c.dropLowest} aria-label={`${c.name} drop lowest`} onBlur={(e) => Number(e.target.value) !== c.dropLowest && void run(() => api(`/classes/${classId}/grading/categories/${c.id}`, { method: 'PATCH', body: { dropLowest: Number(e.target.value) } }), `${c.name} updated.`)} />
            </label>
            <button type="button" className="ml-auto text-xs text-slate-500 hover:text-red-700" disabled={state.busy} onClick={() => void run(() => api(`/classes/${classId}/grading/categories/${c.id}`, { method: 'DELETE' }), `${c.name} removed; its assignments now count by points.`)}>
              Remove
            </button>
          </MotionItem>
        ))}
      </MotionList>
      {grading.categories.length > 0 && <p className={`mt-1 text-xs ${total === 100 ? 'text-green-700' : 'text-amber-700'}`}>Total weight {total}%</p>}
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void run(() => api(`/classes/${classId}/grading/categories`, { method: 'POST', body: { name: cat.name, weight: Number(cat.weight), dropLowest: Number(cat.dropLowest) } }), 'Category added.').then(() => setCat({ name: '', weight: '', dropLowest: '0' }));
        }}
      >
        <Input label="Category" placeholder="Homework" value={cat.name} onChange={(e) => setCat({ ...cat, name: e.target.value })} />
        <Input label="Weight %" type="number" min="0" max="100" value={cat.weight} onChange={(e) => setCat({ ...cat, weight: e.target.value })} />
        <Input label="Drop lowest" type="number" min="0" max="10" value={cat.dropLowest} onChange={(e) => setCat({ ...cat, dropLowest: e.target.value })} />
        <Button type="submit" variant="secondary" loading={state.busy} disabled={!cat.name || cat.weight === ''}>
          Add category
        </Button>
      </form>
    </Card>
  );
}

/** What every member of the class sees: the late policy and syllabus, plus how the grade is computed. */
export function ClassPolicies({ classId }: { classId: string }) {
  const [grading, setGrading] = useState<ClassGrading | null>(null);
  useEffect(() => {
    api<ClassGrading>(`/classes/${classId}/grading`)
      .then(setGrading)
      .catch(() => setGrading(null));
  }, [classId]);
  if (!grading || (!grading.latePolicy && !grading.syllabus && grading.categories.length === 0)) return null;
  return (
    <Card title="How this class is graded" description={grading.gradingMode === 'standards' ? `Standards-based: you are scored on each standard using the ${grading.scale?.name ?? 'school'} scale.` : grading.categories.length ? 'Weighted categories.' : 'Total points earned over points possible.'}>
      {grading.categories.length > 0 && (
        <ul className="mb-3 flex flex-wrap gap-2 text-sm">
          {grading.categories.map((c) => (
            <li key={c.id} className="rounded-full bg-slate-100 px-3 py-1 text-slate-800">
              {c.name} {c.weight}%{c.dropLowest ? ` · drops lowest ${c.dropLowest}` : ''}
            </li>
          ))}
        </ul>
      )}
      {grading.latePolicy && (
        <p className="text-sm text-slate-700">
          <span className="font-medium">Late work:</span> {grading.latePolicy}
        </p>
      )}
      {grading.syllabus && (
        <details className="mt-2 text-sm text-slate-700">
          <summary className="cursor-pointer font-medium">Syllabus</summary>
          <p className="mt-1 whitespace-pre-wrap">{grading.syllabus}</p>
        </details>
      )}
    </Card>
  );
}
