'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type MessageKey } from '@/locales/en';
import { es } from '@/locales/es';
import { api } from './api';
import { useAuth } from './auth';

/**
 * Interface language (docs/13 section 7). Signed-in users carry their locale on the profile, so it follows them
 * to every device; before sign-in the choice lives in this browser, falling back to the browser language.
 */
export type Locale = 'en' | 'es';
export const LOCALES: readonly Locale[] = ['en', 'es'];
export const localeOf = (value: string | null | undefined): Locale => (value?.toLowerCase().startsWith('es') ? 'es' : 'en');

const DICTS: Record<Locale, Record<MessageKey, string>> = { en, es };
type Vars = Record<string, string | number>;
export type Translate = (key: MessageKey, vars?: Vars) => string;
export type Pluralize = (base: string, count: number, vars?: Vars) => string;

export function format(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  return format(DICTS[locale][key] ?? en[key] ?? key, vars);
}

/** `base.one` for exactly one, otherwise `base.other`; `{n}` is always available to the template. */
export function pluralize(locale: Locale, base: string, count: number, vars?: Vars): string {
  const key = `${base}.${count === 1 ? 'one' : 'other'}` as MessageKey;
  return translate(locale, key, { n: count, ...vars });
}

const stored = {
  get(): Locale | null {
    try {
      const v = localStorage.getItem('ss_locale');
      return v === 'en' || v === 'es' ? v : null;
    } catch {
      return null;
    }
  },
  set(locale: Locale): void {
    try {
      localStorage.setItem('ss_locale', locale);
    } catch {
      /* ignore */
    }
  },
};

interface I18nValue {
  locale: Locale;
  /** BCP 47 tag for Intl formatting. */
  tag: string;
  t: Translate;
  n: Pluralize;
  setLocale: (locale: Locale) => Promise<void>;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const { user, reload } = useAuth();
  const [guest, setGuest] = useState<Locale>('en');
  useEffect(() => {
    setGuest(stored.get() ?? localeOf(typeof navigator === 'undefined' ? null : navigator.language));
  }, []);
  const locale: Locale = user ? localeOf(user.locale) : guest;

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback(
    async (next: Locale) => {
      stored.set(next);
      setGuest(next);
      if (user && localeOf(user.locale) !== next) {
        await api('/auth/me', { method: 'PATCH', body: { locale: next } });
        await reload();
      }
    },
    [user, reload],
  );

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      tag: locale === 'es' ? 'es-US' : 'en-US',
      t: (key, vars) => translate(locale, key, vars),
      n: (base, count, vars) => pluralize(locale, base, count, vars),
      setLocale,
    }),
    [locale, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}

export function useT(): Translate {
  return useI18n().t;
}

/** A role or notification category label, falling back to the raw code for anything the dictionary does not know. */
export function labelFor(prefix: 'role' | 'category' | 'tutor.mode' | 'tutor.hint' | 'sup.plan' | 'sup.kind', code: string, t: Translate): string {
  const key = `${prefix}.${code}` as MessageKey;
  return key in en ? t(key) : code;
}

/** Relative time in the interface language: "just now", "5 min ago", then a date. */
export function timeAgo(iso: string, t: Translate, tag = 'en-US', now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return t('time.justNow');
  const m = Math.round(s / 60);
  if (m < 60) return t('time.min', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('time.hours', { n: h });
  const d = Math.round(h / 24);
  return d < 7 ? t('time.days', { n: d }) : new Date(iso).toLocaleDateString(tag);
}
