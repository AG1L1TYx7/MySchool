'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

interface ClassroomStatus {
  linked: boolean;
  courseId?: string;
  assignmentsLinked?: number;
  lastPushAt?: string | null;
}

interface PushCounts {
  assignments: number;
  courseWorkCreated: number;
  grades: number;
  pushed: number;
  skipped: number;
}

/** A class that came from a Google Classroom course can send its grades back there (slice 30). */
export function ClassroomCard({ classId, canPush }: { classId: string; canPush: boolean }) {
  const [status, setStatus] = useState<ClassroomStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<ClassroomStatus>(`/classes/${classId}/classroom`)
      .then(setStatus)
      .catch(() => setStatus({ linked: false }));
  }, [classId]);
  useEffect(load, [load]);
  if (!status?.linked) return null;
  const push = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await api<PushCounts>(`/classes/${classId}/classroom/push-grades`, { method: 'POST', body: {} });
      setNote(`Sent ${r.pushed} of ${r.grades} grades across ${r.assignments} assignments to Google Classroom${r.courseWorkCreated ? ` (${r.courseWorkCreated} new course work items)` : ''}${r.skipped ? `; ${r.skipped} skipped because the student or submission is not in Classroom` : ''}.`);
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Google Classroom" description="This class came from a Google Classroom course. Grades posted here can be written to the course's gradebook; each published assignment becomes a piece of course work there.">
      {error && <Alert>{error}</Alert>}
      {note && <Alert kind="success">{note}</Alert>}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-slate-600">
          Course {status.courseId} · {status.assignmentsLinked ?? 0} assignments linked
          {status.lastPushAt ? ` · last sent ${new Date(status.lastPushAt).toLocaleString()}` : ' · nothing sent yet'}
        </p>
        {canPush && (
          <Button loading={busy} onClick={() => void push()}>
            Send grades to Classroom
          </Button>
        )}
      </div>
    </Card>
  );
}
