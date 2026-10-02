'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AnnouncementCard } from '@/components/announcement-card';
import { MotionItem, MotionList, SkeletonRows } from '@/components/motion';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ANNOUNCEMENT_TYPES, PRIORITIES, type Announcement } from '@/lib/communication';
import type { ClassItem } from '@/lib/curriculum';
import type { Paged } from '@/lib/students';

export default function AnnouncementsPage() {
  const { can, user } = useAuth();
  const [rows, setRows] = useState<Announcement[] | null>(null);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', classId: '', type: 'general', priority: 'normal', pinned: false, publish: true });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const canCreate = can('announcements.create');
  const isAdmin = user?.role === 'principal' || user?.role === 'superintendent' || user?.role === 'super_admin';

  const load = useCallback(async () => {
    try {
      setRows((await api<Paged<Announcement>>('/announcements?pageSize=100')).data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    void load();
    if (canCreate)
      api<{ data: ClassItem[] }>('/classes/mine')
        .then((r) => {
          setClasses(r.data);
          // Teachers post to a class: preselect the first one so the form is ready to send.
          if (!isAdmin) setForm((f) => (f.classId ? f : { ...f, classId: r.data[0]?.id ?? '' }));
        })
        .catch(() => setClasses([]));
  }, [load, canCreate, isAdmin]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { title: form.title.trim(), content: form.content.trim(), type: form.type, priority: form.priority, pinned: form.pinned, publish: form.publish };
      if (form.classId) body.classId = form.classId;
      await api('/announcements', { method: 'POST', body });
      setForm((f) => ({ ...f, title: '', content: '' }));
      setOk(form.publish ? 'Posted. Everyone concerned has been notified.' : 'Saved as a draft.');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function act(label: string, fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      setOk(label);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Announcements</h1>
        <p className="mt-1 text-sm text-slate-500">School and class notices. Pinned and urgent items stay on top.</p>
      </div>
      {error && <Alert>{error}</Alert>}
      {ok && <Alert kind="success">{ok}</Alert>}

      {canCreate && (
        <Card title="Post an announcement" description={isAdmin ? 'Leave the class empty for a school-wide notice.' : 'Posts go to a class you teach: its students, their parents and co-teachers.'}>
          <form onSubmit={(e) => void create(e)} className="space-y-3" noValidate>
            <Input label="Title" value={form.title} onChange={set('title')} required />
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Message</span>
              <textarea className="block w-full rounded-md border-0 px-3 py-2 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500 sm:text-sm" rows={4} value={form.content} onChange={set('content')} required />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <Select label="Audience" id="classId" value={form.classId} onChange={set('classId')}>
                {isAdmin && <option value="">Whole school</option>}
                {!isAdmin && <option value="">{classes.length === 0 ? 'No classes yet' : 'Choose a class'}</option>}
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Select label="Type" id="type" value={form.type} onChange={set('type')}>
                {ANNOUNCEMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
              <Select label="Priority" id="priority" value={form.priority} onChange={set('priority')}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.pinned} onChange={(e) => setForm((f) => ({ ...f, pinned: e.target.checked }))} /> Pin to top
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.publish} onChange={(e) => setForm((f) => ({ ...f, publish: e.target.checked }))} /> Publish now
              </label>
              <Button type="submit" loading={busy} disabled={!form.title.trim() || !form.content.trim() || (!isAdmin && !form.classId)}>
                {form.publish ? 'Post' : 'Save draft'}
              </Button>
            </div>
            {form.priority === 'urgent' && <p className="text-xs text-amber-700">Urgent notices are also emailed to everyone concerned, regardless of their preferences.</p>}
          </form>
        </Card>
      )}

      {rows === null ? (
        <SkeletonRows rows={4} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">No announcements yet.</p>
      ) : (
        <MotionList as="div" className="space-y-3">
          {rows.map((a) => (
            <MotionItem as="div" key={a.id}>
              <AnnouncementCard
                a={a}
                onPublish={a.canEdit && a.status === 'draft' ? () => void act('Published.', () => api(`/announcements/${a.id}/publish`, { method: 'POST' })) : undefined}
                onDelete={a.canEdit ? () => confirm('Delete this announcement?') && void act('Deleted.', () => api(`/announcements/${a.id}`, { method: 'DELETE' })) : undefined}
                onPin={a.canEdit ? () => void act(a.pinned ? 'Unpinned.' : 'Pinned.', () => api(`/announcements/${a.id}`, { method: 'PATCH', body: { pinned: !a.pinned } })) : undefined}
              />
            </MotionItem>
          ))}
        </MotionList>
      )}
    </div>
  );
}
