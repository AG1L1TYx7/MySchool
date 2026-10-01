'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Card } from '@/components/ui';
import { api } from '@/lib/api';
import { ROLE_LABELS, useAuth } from '@/lib/auth';
import type { ClassItem } from '@/lib/curriculum';
import { label } from '@/lib/students';

function MyClasses() {
  const [classes, setClasses] = useState<ClassItem[] | null>(null);
  useEffect(() => {
    api<{ data: ClassItem[] }>('/classes/mine')
      .then((r) => setClasses(r.data))
      .catch(() => setClasses([]));
  }, []);
  if (!classes || classes.length === 0) return null;
  return (
    <Card title="My classes" description="Classes you teach or attend this term.">
      <ul className="grid gap-3 md:grid-cols-2">
        {classes.map((c) => (
          <li key={c.id}>
            <Link href={`/classes/${c.id}`} className="block rounded-lg bg-slate-50 px-4 py-3 hover:bg-brand-50">
              <p className="font-medium text-slate-900">{c.name}</p>
              <p className="text-xs text-slate-500">
                {c.course.courseCode} · {c.course.title} · {c.term}
                {c.myEnrollmentStatus ? ` · ${label(c.myEnrollmentStatus)}` : ''}
                {c.teachers[0] ? ` · ${c.teachers[0].firstName} ${c.teachers[0].lastName}` : ''}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;
  const categories = new Map<string, number>();
  for (const code of user.features) {
    const cat = code.split('.')[0];
    categories.set(cat, (categories.get(cat) ?? 0) + 1);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Good to see you, {user.firstName}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Signed in as {ROLE_LABELS[user.role] ?? user.role}
          {user.lastLoginAt ? ` · last sign-in ${new Date(user.lastLoginAt).toLocaleString()}` : ''}
        </p>
      </div>

      {!user.twoFactorEnabled && (
        <Alert kind="info">
          Protect your account with two-factor authentication.{' '}
          <Link href="/settings/security" className="font-medium underline">
            Set it up now
          </Link>
          .
        </Alert>
      )}

      <MyClasses />

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Your access" description="What this account can do, from your role and any individual overrides.">
          <ul className="grid grid-cols-2 gap-2 text-sm">
            {Array.from(categories.entries()).sort().map(([cat, n]) => (
              <li key={cat} className="flex justify-between rounded-md bg-slate-50 px-3 py-2">
                <span className="capitalize text-slate-700">{cat.replace(/-/g, ' ')}</span>
                <span className="font-medium text-slate-900">{n}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Coming next" description="Release 1 builds out these areas slice by slice.">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            <li>Courses, modules and lessons</li>
            <li>Classes, rosters and attendance</li>
            <li>Assignments, submissions and grading</li>
            <li>AI tutor and content generation</li>
            <li>Messaging, announcements and notifications</li>
          </ol>
        </Card>
      </div>
    </div>
  );
}
