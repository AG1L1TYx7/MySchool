'use client';

import { LOCALES, useI18n, type Locale } from '@/lib/i18n';

/** English / Español. Saved on the profile when signed in, in this browser otherwise. */
export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <select aria-label={t('lang.label')} value={locale} onChange={(e) => void setLocale(e.target.value as Locale)} className={`rounded-md border-0 bg-white py-1 pl-2 pr-7 text-xs text-slate-700 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500 ${className}`}>
      {LOCALES.map((l) => (
        <option key={l} value={l}>
          {t(`lang.${l}`)}
        </option>
      ))}
    </select>
  );
}
