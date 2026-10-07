'use client';

import { useEffect, useState } from 'react';
import { LanguageSwitcher } from '@/components/language-switcher';
import { Logo } from '@/components/ui';
import { fetchBranding, type PublicBranding } from '@/lib/district';
import { useT } from '@/lib/i18n';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = useT();
  // The tenant behind this host names and colours the page (ADR-005); the default look is used until it answers.
  const [brand, setBrand] = useState<PublicBranding | null>(null);
  useEffect(() => {
    fetchBranding()
      .then(setBrand)
      .catch(() => setBrand(null));
  }, []);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-8 flex w-full max-w-md items-center justify-between">
        <Logo className="text-lg" brand={brand} />
        <LanguageSwitcher />
      </div>
      {/* Plain container: the sign-in pages ship without the motion library so the first paint is fast. */}
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-sm ring-1 ring-slate-200">{children}</div>
      <p className="mt-8 text-xs text-slate-600">{t('auth.footer')}</p>
      {brand?.tenant && brand.displayName !== 'SmartSchool' && (
        <p className="mt-1 text-xs text-slate-600">
          {t('auth.hostedBy', { name: brand.displayName })}
          {brand.supportEmail ? ` · ${brand.supportEmail}` : ''}
        </p>
      )}
    </main>
  );
}
