'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { MotionPage } from '@/components/motion';
import { NotificationBell } from '@/components/notification-bell';
import { Button, Logo } from '@/components/ui';
import { ROLE_LABELS, useAuth } from '@/lib/auth';

/** Navigation is driven by the caller's effective feature codes, never by hard-coded roles. */
const NAV: Array<{ href: string; label: string; feature: string }> = [
  { href: '/dashboard', label: 'Dashboard', feature: 'dashboard.view' },
  { href: '/courses', label: 'Courses', feature: 'courses.view' },
  { href: '/classes', label: 'Classes', feature: 'classes.view' },
  { href: '/assignments', label: 'Assignments', feature: 'assignments.view' },
  { href: '/announcements', label: 'Announcements', feature: 'announcements.view' },
  { href: '/messages', label: 'Messages', feature: 'messages.view' },
  { href: '/tutor', label: 'AI tutor', feature: 'ai.tutor.chat' },
  { href: '/grades', label: 'Grades', feature: 'grades.view.own' },
  { href: '/grades', label: 'Grades', feature: 'grades.view.child' },
  { href: '/content', label: 'Interactive content', feature: 'h5p.create' },
  { href: '/students', label: 'Students', feature: 'students.view' },
  { href: '/users', label: 'Users', feature: 'users.view' },
  { href: '/organizations', label: 'Organisations', feature: 'organizations.view' },
  { href: '/audit-logs', label: 'Audit log', feature: 'audit.logs.view' },
  { href: '/settings/security', label: 'Security', feature: 'profile.view' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, can, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    // Privileged roles must finish two-factor setup before anything else (docs/11 section 3).
    if (user?.mfaSetupRequired && pathname !== '/settings/security') router.replace('/settings/security?mfa=required');
  }, [loading, user, router, pathname]);

  if (loading || !user) {
    return <main className="grid min-h-screen place-items-center text-sm text-slate-500">Loading…</main>;
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside aria-label="Sidebar" className="border-b border-slate-200 bg-white px-4 py-4 md:border-b-0 md:border-r">
        <Logo />
        <nav aria-label="Primary" className="mt-6 flex gap-1 overflow-x-auto md:flex-col">
          {NAV.filter((n) => can(n.feature))
            .filter((n, i, all) => all.findIndex((x) => x.href === n.href) === i)
            .map((n) => {
            const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-md px-3 py-2 text-sm font-medium ${active ? 'bg-brand-50 text-brand-800' : 'text-slate-700 hover:bg-slate-100'}`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-h-screen flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div className="text-sm">
            <span className="font-medium text-slate-900">
              {user.firstName} {user.lastName}
            </span>
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{ROLE_LABELS[user.role] ?? user.role}</span>
          </div>
          <div className="flex items-center gap-2">
            {can('notifications.view') && <NotificationBell />}
            <Button variant="secondary" onClick={() => void logout().then(() => router.replace('/login'))}>
              Sign out
            </Button>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8">
          <AnimatePresence mode="wait" initial={false}>
            <MotionPage key={pathname}>{children}</MotionPage>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
