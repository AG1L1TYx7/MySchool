'use client';

import { useCallback, useEffect, useState } from 'react';
import { MotionItem, MotionList, SkeletonRows } from '@/components/motion';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Button, Card } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { CodeLesson, CodeLessonSummary, RunResult } from '@/lib/careers';

/** Code lessons: short JavaScript exercises checked by tests that run in the sandbox (ADR-013). */
export default function CodePage() {
  const { can } = useAuth();
  const [lessons, setLessons] = useState<CodeLessonSummary[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [current, setCurrent] = useState<CodeLesson | null>(null);
  const [source, setSource] = useState('');
  const [result, setResult] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<{ available: boolean; lessons: CodeLessonSummary[] }>('/code/lessons')
      .then((r) => {
        setLessons(r.lessons);
        setAvailable(r.available);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  if (!can('code.learn')) return <NotForYou what="code lessons" back="/dashboard" />;
  const open = async (id: string) => {
    setError(null);
    setResult(null);
    try {
      const l = await api<CodeLesson>(`/code/lessons/${id}`);
      setCurrent(l);
      setSource(l.lastSubmission?.source ?? l.starter);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const run = async () => {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api<RunResult>(`/code/lessons/${current.id}/run`, { method: 'POST', body: { source } }));
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Code lessons</h1>
        <p className="mt-1 text-sm text-slate-600">Short JavaScript exercises. Your code runs in a locked box on the server with a time and memory limit, and the tests say exactly what they expected and what they got.</p>
      </div>
      {!available && <Alert kind="info">Code runs are switched off on this server.</Alert>}
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Card title="Lessons">
          {!lessons ? (
            <SkeletonRows rows={4} />
          ) : (
            <MotionList className="space-y-1">
              {lessons.map((l) => (
                <MotionItem key={l.id}>
                  <button type="button" className={`w-full rounded-lg p-2 text-left text-sm ring-1 ${current?.id === l.id ? 'bg-brand-50 ring-brand-200' : 'bg-white ring-slate-200 hover:bg-slate-50'}`} onClick={() => void open(l.id)}>
                    <span className="font-medium">{l.title}</span>
                    <span className="block text-xs text-slate-600">
                      Level {l.level} · {l.tests} test{l.tests === 1 ? '' : 's'}
                      {l.bestPassed !== null ? ` · best ${l.bestPassed} of ${l.tests}` : ''}
                    </span>
                  </button>
                </MotionItem>
              ))}
            </MotionList>
          )}
        </Card>
        <Card title={current ? current.title : 'Pick a lesson'} description={current?.description}>
          {current ? (
            <div className="space-y-3">
              <label htmlFor="code-source" className="block text-sm font-medium text-slate-700">
                Your code
              </label>
              <textarea id="code-source" className="h-56 w-full rounded-md border border-slate-300 p-2 font-mono text-sm" spellCheck={false} value={source} onChange={(e) => setSource(e.target.value)} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-600">
                  Tests: {current.tests.map((t) => `${t.label} → ${t.expected}`).join(' · ')}
                </p>
                <Button loading={busy} disabled={!available} onClick={() => void run()}>
                  Run the tests
                </Button>
              </div>
              {result && (
                <div className={`rounded-lg p-3 text-sm ${result.status === 'passed' ? 'bg-emerald-50' : result.status === 'error' ? 'bg-rose-50' : 'bg-amber-50'}`} role="status">
                  <p className="font-medium">
                    {result.status === 'passed' ? 'All tests pass.' : result.status === 'error' ? 'Your code did not run.' : `${result.passed} of ${result.total} tests pass.`} <span className="text-xs text-slate-600">({result.runtimeMs} ms)</span>
                  </p>
                  {result.error && <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-rose-800">{result.error}</pre>}
                  <ul className="mt-2 space-y-1">
                    {result.outcomes.map((o) => (
                      <li key={o.label} className="font-mono text-xs">
                        {o.passed ? '✓' : '✗'} {o.label} expected {o.expected}, got {o.got}
                      </li>
                    ))}
                  </ul>
                  {result.output && (
                    <pre className="mt-2 whitespace-pre-wrap rounded bg-white p-2 font-mono text-xs" aria-label="Program output">
                      {result.output}
                    </pre>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-600">Choose a lesson on the left to start.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
