'use client';

import { useCallback, useEffect, useState } from 'react';
import { MotionItem, MotionList, SkeletonRows } from '@/components/motion';
import { Button, Card } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { PushDevice } from '@/lib/communication';
import { timeAgo, useI18n } from '@/lib/i18n';

/** The phones and browsers registered for push, with a test button; honest about whether push is configured. */
export function DevicesCard() {
  const { t, tag } = useI18n();
  const [devices, setDevices] = useState<PushDevice[] | null>(null);
  const [configured, setConfigured] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await api<{ data: PushDevice[]; configured: boolean }>('/me/devices');
      setDevices(r.data);
      setConfigured(r.configured);
    } catch (err) {
      setNote(errorMessage(err));
      setDevices([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function test() {
    try {
      const r = await api<{ configured: boolean; devices: number; sent: number; simulated: number }>('/me/devices/test', { method: 'POST' });
      setNote(r.configured ? t('notif.testSent', { n: r.sent }) : t('notif.testSimulated'));
    } catch (err) {
      setNote(errorMessage(err));
    }
  }
  async function remove(d: PushDevice) {
    try {
      await api(`/me/devices/${d.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setNote(errorMessage(err));
    }
  }

  return (
    <Card title={t('notif.devices')} description={t('notif.devicesDesc')} actions={devices && devices.length > 0 ? <Button variant="secondary" onClick={() => void test()}>{t('notif.testPush')}</Button> : undefined}>
      {!configured && <p className="mb-2 text-xs text-slate-600">{t('notif.pushNotConfigured')}</p>}
      {note && (
        <p className="mb-2 text-sm text-slate-700" role="status">
          {note}
        </p>
      )}
      {devices === null ? (
        <SkeletonRows rows={2} />
      ) : devices.length === 0 ? (
        <p className="text-sm text-slate-500">{t('notif.noDevices')}</p>
      ) : (
        <MotionList className="divide-y divide-slate-100">
          {devices.map((d) => (
            <MotionItem key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div>
                <p className="font-medium text-slate-900">
                  {d.name ?? d.platform}
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{d.platform}</span>
                  {!d.active && <span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-900">off</span>}
                </p>
                <p className="text-xs text-slate-600">
                  {t('notif.lastSeen', { when: timeAgo(d.lastSeenAt, t, tag) })}
                  {d.appVersion ? ` · v${d.appVersion}` : ''}
                </p>
              </div>
              <Button variant="secondary" onClick={() => void remove(d)}>
                {t('notif.removeDevice')}
              </Button>
            </MotionItem>
          ))}
        </MotionList>
      )}
    </Card>
  );
}
