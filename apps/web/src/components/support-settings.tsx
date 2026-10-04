'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Card, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { SupportSettings } from '@/lib/support';

/** School-level rules: what families see of behaviour, the under-13 AI consent default, student-to-student messaging. */
export function SupportSettingsCard({ organizationId }: { organizationId: string }) {
  const { can } = useAuth();
  const manage = can('organizations.structure');
  const [form, setForm] = useState<SupportSettings | null>(null);
  const [state, setState] = useState<{ error?: string; ok?: string; busy?: boolean }>({});
  const load = useCallback(async () => {
    try {
      setForm(await api<SupportSettings>(`/organizations/${organizationId}/support/settings`));
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, [organizationId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!form) return null;
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setState({ busy: true });
    try {
      await api(`/organizations/${organizationId}/support/settings`, { method: 'PUT', body: form });
      setState({ ok: 'Support settings saved.' });
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  return (
    <Card title="Support and safety" description="Rules every family and student in this school gets.">
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}
      <form onSubmit={save} className="grid gap-3 md:grid-cols-3" noValidate>
        <Select label="Behaviour records families can see" disabled={!manage} value={form.behaviorVisibility} onChange={(e) => setForm({ ...form, behaviorVisibility: e.target.value as SupportSettings['behaviorVisibility'] })}>
          <option value="POSITIVE_ONLY">Positive notes only</option>
          <option value="ALL">Everything</option>
          <option value="NONE">Nothing unless marked</option>
        </Select>
        <Select label="AI features for students under 13" disabled={!manage} value={form.aiConsentDefault} onChange={(e) => setForm({ ...form, aiConsentDefault: e.target.value as SupportSettings['aiConsentDefault'] })}>
          <option value="SCHOOL">School consents; parents may opt out</option>
          <option value="PARENT">Off until a parent says yes</option>
        </Select>
        <Select label="Students message classmates" disabled={!manage} value={form.studentMessaging ? 'on' : 'off'} onChange={(e) => setForm({ ...form, studentMessaging: e.target.value === 'on' })}>
          <option value="off">Off (class conversations a teacher opens)</option>
          <option value="on">On, within shared classes</option>
        </Select>
        {manage && (
          <div className="md:col-span-3">
            <Button type="submit" loading={state.busy}>
              Save support settings
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
