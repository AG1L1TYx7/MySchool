'use client';

import { useEffect, useState } from 'react';
import { Input, Select } from '@/components/ui';
import { api } from '@/lib/api';
import type { Standard, StandardSet } from '@/lib/gradebook';
import type { Paged } from '@/lib/students';

/** Search the standards catalogue and pick the ones a lesson or assignment covers. */
export function StandardsPicker({ value, onChange, gradeLevel }: { value: Standard[]; onChange: (next: Standard[]) => void; gradeLevel?: string | null }) {
  const [sets, setSets] = useState<StandardSet[]>([]);
  const [setId, setSetId] = useState('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Standard[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ data: StandardSet[] }>('/standards/sets')
      .then((r) => setSets(r.data))
      .catch(() => setSets([]));
  }, []);
  useEffect(() => {
    if (!setId && search.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      setBusy(true);
      const params = new URLSearchParams({ pageSize: '25' });
      if (setId) params.set('setId', setId);
      if (search.trim()) params.set('search', search.trim());
      if (gradeLevel) params.set('gradeLevel', gradeLevel);
      api<Paged<Standard>>(`/standards?${params.toString()}`)
        .then((r) => setResults(r.data))
        .catch(() => setResults([]))
        .finally(() => setBusy(false));
    }, 250);
    return () => clearTimeout(t);
  }, [setId, search, gradeLevel]);

  const chosen = new Set(value.map((s) => s.id));
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Chosen standards">
          {value.map((s) => (
            <li key={s.id} className="flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-900 ring-1 ring-inset ring-brand-200" title={s.description}>
              <span className="font-mono">{s.code}</span>
              <button type="button" aria-label={`Remove ${s.code}`} className="text-brand-700 hover:text-red-700" onClick={() => onChange(value.filter((x) => x.id !== s.id))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 md:grid-cols-2">
        <Select label="Standard set" value={setId} onChange={(e) => setSetId(e.target.value)}>
          <option value="">Any set</option>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} · {s.name}
            </option>
          ))}
        </Select>
        <Input label="Find a standard" placeholder="Code or words, e.g. linear equations" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {(results.length > 0 || busy) && (
        <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-md ring-1 ring-slate-200" aria-label="Matching standards">
          {busy && results.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">Searching…</li>}
          {results.map((s) => (
            <li key={s.id}>
              <button type="button" disabled={chosen.has(s.id)} className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50" onClick={() => onChange([...value, s])}>
                <span className="shrink-0 font-mono text-xs text-slate-700">{s.code}</span>
                <span className="min-w-0 flex-1 text-slate-600">{s.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StandardChips({ standards }: { standards: Array<{ id: string; code: string; description: string }> }) {
  if (standards.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Standards">
      {standards.map((s) => (
        <li key={s.id} className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700" title={s.description}>
          {s.code}
        </li>
      ))}
    </ul>
  );
}
