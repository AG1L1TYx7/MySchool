'use client';

import Link from 'next/link';
import { Card } from '@/components/ui';
import { useT } from '@/lib/i18n';

/** Shown when a page exists but the signed-in role has no access to it, without calling the API. */
export function NotForYou({ what, back, alt }: { what: string; back: string; alt?: { href: string; label: string } }) {
  const t = useT();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">{t('nfy.title')}</h1>
      <Card>
        <p className="text-sm text-slate-500">{t('nfy.staffOnly', { what })}</p>
        <p className="mt-2 text-sm text-slate-600">
          <Link href={back} className="text-brand-700 underline">
            {back === '/dashboard' ? t('nfy.backDashboard') : t('nfy.backClass')}
          </Link>
          {alt && (
            <>
              {' · '}
              <Link href={alt.href} className="text-brand-700 underline">
                {t('nfy.see', { label: alt.label })}
              </Link>
            </>
          )}
        </p>
      </Card>
    </div>
  );
}
