'use client';

import { MotionConfig } from 'framer-motion';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { NO_ACCOMMODATIONS, type MyAccommodations } from '@/lib/support';

const Ctx = createContext<MyAccommodations>(NO_ACCOMMODATIONS);

/**
 * Applies a student's accommodations everywhere (docs/13 section 6): larger text, reduced motion,
 * a reduced-distraction layout, and read-aloud buttons. Staff and parents get the defaults.
 */
export function AccommodationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [value, setValue] = useState<MyAccommodations>(NO_ACCOMMODATIONS);
  useEffect(() => {
    if (user?.role !== 'student') {
      setValue(NO_ACCOMMODATIONS);
      return;
    }
    api<MyAccommodations>('/me/accommodations')
      .then(setValue)
      .catch(() => setValue(NO_ACCOMMODATIONS));
  }, [user?.role, user?.id]);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('a11y-large-text', value.largeText);
    root.classList.toggle('a11y-focus', value.reducedDistraction);
    return () => {
      root.classList.remove('a11y-large-text', 'a11y-focus');
    };
  }, [value.largeText, value.reducedDistraction]);
  return (
    <Ctx.Provider value={value}>
      <MotionConfig reducedMotion={value.reducedMotion ? 'always' : 'user'}>{children}</MotionConfig>
    </Ctx.Provider>
  );
}

export function useAccommodations(): MyAccommodations {
  return useContext(Ctx);
}

/** Reads a block of text out loud with the browser's own voice; shown when the student's plan asks for it. */
export function ReadAloud({ text, label = 'Read aloud' }: { text: string; label?: string }) {
  const { readAloud } = useAccommodations();
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  if (!readAloud || typeof window === 'undefined' || !('speechSynthesis' in window) || !text.trim()) return null;
  const toggle = () => {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  };
  return (
    <button type="button" aria-pressed={speaking} onClick={toggle} className="mb-2 inline-flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-200 hover:bg-brand-100">
      <span aria-hidden>{speaking ? '■' : '▶'}</span> {speaking ? 'Stop' : label}
    </button>
  );
}
