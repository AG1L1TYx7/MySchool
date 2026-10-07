'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { MotionPage } from '@/components/motion';
import { AccommodationsProvider } from '@/components/accommodations';
import { LanguageSwitcher } from '@/components/language-switcher';
import { XpPill } from '@/components/motivation-cards';
import { NotificationBell } from '@/components/notification-bell';
import { Button, Logo } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { labelFor, useT } from '@/lib/i18n';
import type { MessageKey } from '@/locales/en';

/** Navigation is driven by the caller's effective feature codes, never by hard-coded roles. */
const NAV: Array<{ href: string; label: MessageKey; feature: string; roles?: string[] }> = [
  { href: '/dashboard', label: 'nav.dashboard', feature: 'dashboard.view' },
  { href: '/motivation', label: 'nav.motivation', feature: 'motivation.view', roles: ['student'] },
  { href: '/practice', label: 'nav.practice', feature: 'learning.view', roles: ['student'] },
  { href: '/family', label: 'nav.family', feature: 'family.view' },
  { href: '/courses', label: 'nav.courses', feature: 'courses.view' },
  { href: '/classes', label: 'nav.classes', feature: 'classes.view' },
  { href: '/assignments', label: 'nav.assignments', feature: 'assignments.view' },
  { href: '/calendar', label: 'nav.calendar', feature: 'calendar.view' },
  { href: '/announcements', label: 'nav.announcements', feature: 'announcements.view' },
  { href: '/messages', label: 'nav.messages', feature: 'messages.view' },
  { href: '/tutor', label: 'nav.tutor', feature: 'ai.tutor.chat' },
  { href: '/assistant', label: 'nav.assistant', feature: 'ai.assistant' },
  { href: '/planner', label: 'nav.planner', feature: 'planner.view' },
  { href: '/grades', label: 'nav.grades', feature: 'grades.view.own' },
  { href: '/grades', label: 'nav.grades', feature: 'grades.view.child' },
  { href: '/report-cards', label: 'nav.reportCards', feature: 'report-cards.view.all' },
  { href: '/report-cards', label: 'nav.reportCards', feature: 'report-cards.view.own' },
  { href: '/report-cards', label: 'nav.reportCards', feature: 'report-cards.view.child' },
  { href: '/standards', label: 'nav.standards', feature: 'standards.view' },
  { href: '/caseload', label: 'nav.caseload', feature: 'support.notes' },
  { href: '/wellness', label: 'nav.wellness', feature: 'wellness.alerts' },
  { href: '/content', label: 'nav.content', feature: 'h5p.create' },
  { href: '/students', label: 'nav.students', feature: 'students.view' },
  { href: '/users', label: 'nav.users', feature: 'users.view' },
  { href: '/organizations', label: 'nav.organizations', feature: 'organizations.view' },
  { href: '/audit-logs', label: 'nav.auditLog', feature: 'audit.logs.view' },
  { href: '/settings/security', label: 'nav.security', feature: 'profile.view' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, can, logout } = useAuth();
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    // Privileged roles must finish two-factor setup before anything else (docs/11 section 3).
    if (user?.mfaSetupRequired && pathname !== '/settings/security') router.replace('/settings/security?mfa=required');
  }, [loading, user, router, pathname]);

  if (loading || !user) {
    return <main className="grid min-h-screen place-items-center text-sm text-slate-500">{t('common.loading')}</main>;
  }

  return (
    <AccommodationsProvider>
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside aria-label={t('shell.sidebar')} className="border-b border-slate-200 bg-white px-4 py-4 md:border-b-0 md:border-r">
        <Logo />
        <nav aria-label={t('shell.primary')} className="mt-6 flex gap-1 overflow-x-auto md:flex-col">
          {NAV.filter((n) => can(n.feature) && (!n.roles || n.roles.includes(user.role)))
            .filter((n, i, all) => all.findIndex((x) => x.href === n.href) === i)
            .map((n) => {
            const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-md px-3 py-2 text-sm font-medium ${active ? 'bg-brand-50 text-brand-800' : 'text-slate-700 hover:bg-slate-100'}`}
              >
                {t(n.label)}
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
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{labelFor('role', user.role, t)}</span>
          </div>
          <div className="flex items-center gap-2">
            <XpPill />
            <LanguageSwitcher />
            {can('notifications.view') && <NotificationBell />}
            <Button variant="secondary" onClick={() => void logout().then(() => router.replace('/login'))}>
              {t('shell.signOut')}
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
    </AccommodationsProvider>
  );
}
