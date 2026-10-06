'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Alert } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';

export default function SsoCompletePage() {
  return (
    <Suspense fallback={<Working />}>
      <Complete />
    </Suspense>
  );
}

function Working() {
  const t = useT();
  return <p className="text-sm text-slate-600">{t('sso.signingIn')}</p>;
}

/** Landing after a provider sign-in: the refresh cookie is already set; load the profile and go on. */
function Complete() {
  const router = useRouter();
  const params = useSearchParams();
  const { reload, user } = useAuth();
  const t = useT();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('ss_session', '1');
    } catch {
      /* ignore */
    }
    void reload().then(() => setFailed(false)).catch(() => setFailed(true));
  }, [reload]);

  useEffect(() => {
    if (!user) return;
    const next = params.get('next') ?? '/dashboard';
    router.replace(params.get('mfaSetup') === '1' ? '/settings/security?mfa=required' : next.startsWith('/') ? next : '/dashboard');
  }, [user, params, router]);

  if (failed) return <Alert>{t('sso.failed')}</Alert>;
  return <Working />;
}
