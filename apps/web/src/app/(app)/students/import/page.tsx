'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Button, Card } from '@/components/ui';
import { api, download, errorMessage } from '@/lib/api';
import type { ImportResult } from '@/lib/students';

export default function ImportStudentsPage() {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [state, setState] = useState<{ error?: string; busy?: boolean }>({});

  async function readFile(file: File) {
    setFileName(file.name);
    setCsv(await file.text());
    setPreview(null);
    setResult(null);
  }

  async function run(dryRun: boolean) {
    setState({ busy: true });
    try {
      const res = await api<ImportResult>(`/students/import${dryRun ? '?dryRun=true' : ''}`, { method: 'POST', body: { csv } });
      if (dryRun) setPreview(res);
      else setResult(res);
      setState({});
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }

  const summary = result ?? preview;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Import students</h1>
        <a href="/api/v1/students/import/template" className="text-sm font-medium text-brand-700 hover:underline" onClick={(e) => (e.preventDefault(), void downloadTemplate())}>
          Download template
        </a>
      </div>

      <Card title="1. Choose a CSV file" description="Required columns: studentNumber, firstName, lastName. Optional: email, phone, dateOfBirth, gender, gradeLevel, enrollmentStatus, enrollmentDate, preferredLearningStyle, guardianEmail, guardianFirstName, guardianLastName, guardianRelationship. Existing student numbers are updated; new ones are created; guardians are linked (and invited when unknown).">
        <input type="file" accept=".csv,text/csv" className="block text-sm" onChange={(e) => e.target.files?.[0] && void readFile(e.target.files[0])} />
        {fileName && <p className="mt-2 text-xs text-slate-500">{fileName}: {csv.split('\n').filter((l) => l.trim()).length - 1} data rows</p>}
        <textarea className="mt-4 h-40 w-full rounded-md border-0 p-3 font-mono text-xs shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500" placeholder="…or paste CSV text here" value={csv} onChange={(e) => (setCsv(e.target.value), setPreview(null), setResult(null))} />
      </Card>

      <Card title="2. Check, then import">
        {state.error && <Alert>{state.error}</Alert>}
        <div className="flex gap-2">
          <Button variant="secondary" disabled={!csv.trim()} loading={state.busy && !preview} onClick={() => void run(true)}>
            Check file
          </Button>
          <Button disabled={!preview || preview.errors.length === preview.total} loading={state.busy && !!preview} onClick={() => void run(false)}>
            Import {preview ? `${preview.created + preview.updated} rows` : ''}
          </Button>
        </div>
        {summary && (
          <div className="mt-4 space-y-3 text-sm">
            <Alert kind={summary.errors.length ? 'info' : 'success'}>
              {summary.dryRun ? 'Check complete' : 'Import complete'}: {summary.created} to create, {summary.updated} to update, {summary.guardiansLinked} guardian links
              {summary.dryRun ? '' : `, ${summary.invitationsSent} invitations sent`}
              {summary.errors.length ? `, ${summary.errors.length} row(s) with problems` : ''}.
            </Alert>
            {summary.errors.length > 0 && (
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-1 pr-4">Line</th>
                    <th className="py-1">Problem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.errors.map((e, i) => (
                    <tr key={i}>
                      <td className="py-1 pr-4 font-mono text-xs">{e.line}</td>
                      <td className="py-1 text-red-700">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {result && (
              <Link href="/students" className="inline-block font-medium text-brand-700 hover:underline">
                Back to students
              </Link>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

async function downloadTemplate() {
  await download('/students/import/template', 'students-template.csv');
}
