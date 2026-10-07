'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card } from '@/components/ui';
import { api, download, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { DeletionPlan, DeletionRequest } from '@/lib/compliance';
import { useI18n } from '@/lib/i18n';

/** Family-facing (bilingual): a copy of the records, and a request to erase them, with the plan spelled out. */
export function FamilyRecordsCard({ studentId, lastName }: { studentId: string; lastName: string }) {
  const { t, tag } = useI18n();
  const [requests, setRequests] = useState<DeletionRequest[] | null>(null);
  const [plan, setPlan] = useState<DeletionPlan | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await api<{ data: DeletionRequest[]; plan: DeletionPlan }>(`/students/${studentId}/deletion-requests`);
      setRequests(r.data);
      setPlan(r.plan);
    } catch {
      setRequests([]);
    }
  }, [studentId]);
  useEffect(() => {
    void load();
  }, [load]);
  const open = requests?.find((r) => r.status === 'pending' || r.status === 'approved');
  async function requestDeletion() {
    setBusy(true);
    try {
      await api(`/students/${studentId}/deletion-requests`, { method: 'POST', body: {} });
      setNote(t('records.requested'));
      await load();
    } catch (err) {
      setNote(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title={t('records.title')} description={t('records.desc')}>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => download(`/students/${studentId}/records-export.zip`, `records-${lastName}.zip`).catch((e) => setNote(errorMessage(e)))}>
          {t('records.download')}
        </Button>
        {!open && (
          <Button variant="secondary" loading={busy} onClick={() => void requestDeletion()}>
            {t('records.requestDeletion')}
          </Button>
        )}
      </div>
      {open && (
        <p className="mt-2 text-sm text-slate-700" role="status">
          {open.status === 'approved' && open.scheduledFor ? t('records.approved', { date: new Date(open.scheduledFor).toLocaleDateString(tag) }) : t('records.pending')}
        </p>
      )}
      {note && (
        <p className="mt-2 text-sm text-slate-700" role="status">
          {note}
        </p>
      )}
      {plan && (
        <details className="mt-3 text-xs text-slate-600">
          <summary className="cursor-pointer">{t('records.whatGoes', { days: plan.graceDays })}</summary>
          <ul className="mt-1 list-disc pl-5">
            {plan.removes.map((p) => (
              <li key={p.key}>{p.label}</li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

/** Staff-facing on the student page: the records export and the legal hold (administrators). English. */
export function StudentRecordsCard({ studentId, lastName, legalHold, onChanged }: { studentId: string; lastName: string; legalHold: boolean; onChanged: () => Promise<void> }) {
  const { can } = useAuth();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!can('compliance.view')) return null;
  async function toggleHold() {
    setBusy(true);
    try {
      await api(`/students/${studentId}/legal-hold`, { method: 'PUT', body: { legalHold: !legalHold } });
      await onChanged();
      setNote(legalHold ? 'Legal hold lifted.' : 'Legal hold set: erasure is blocked until it is lifted.');
    } catch (err) {
      setNote(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Records and retention" description="A copy of the education records as a zip of JSON files (FERPA), and the legal hold that blocks erasure during litigation or an investigation.">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => download(`/students/${studentId}/records-export.zip`, `records-${lastName}.zip`).catch((e) => setNote(errorMessage(e)))}>
          Download records (zip)
        </Button>
        {can('compliance.manage') && (
          <Button variant={legalHold ? 'danger' : 'secondary'} loading={busy} onClick={() => void toggleHold()}>
            {legalHold ? 'Lift legal hold' : 'Set legal hold'}
          </Button>
        )}
        {legalHold && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-900">Legal hold</span>}
      </div>
      {note && (
        <p className="mt-2 text-sm text-slate-700" role="status">
          {note}
        </p>
      )}
    </Card>
  );
}
