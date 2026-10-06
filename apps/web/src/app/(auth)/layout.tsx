'use client';

import { LanguageSwitcher } from '@/components/language-switcher';
import { Logo } from '@/components/ui';
import { useT } from '@/lib/i18n';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-8 flex w-full max-w-md items-center justify-between">
        <Logo className="text-lg" />
        <LanguageSwitcher />
      </div>
      {/* Plain container: the sign-in pages ship without the motion library so the first paint is fast. */}
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-sm ring-1 ring-slate-200">{children}</div>
      <p className="mt-8 text-xs text-slate-600">{t('auth.footer')}</p>
    </main>
  );
}
