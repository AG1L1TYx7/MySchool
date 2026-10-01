'use client';

import { useReducedMotion } from 'framer-motion';
import type { Transition, Variants } from 'framer-motion';

/**
 * Motion tokens (docs/12 section 3). Every animated component reads these so the whole
 * product moves with one voice, and so reduced-motion is honoured in one place.
 */
export const duration = { fast: 0.15, base: 0.24, slow: 0.32, celebrate: 1.1 } as const;
export const ease = { enter: [0.2, 0, 0, 1] as const, exit: [0.4, 0, 1, 1] as const };
export const spring = { soft: { type: 'spring', stiffness: 260, damping: 24 } as const };

export const transitions: Record<'enter' | 'exit' | 'fast', Transition> = {
  enter: { duration: duration.base, ease: ease.enter },
  exit: { duration: duration.fast, ease: ease.exit },
  fast: { duration: duration.fast, ease: ease.enter },
};

/** Page or panel: fade and 8 px rise. */
export const fadeRise: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: transitions.enter },
  exit: { opacity: 0, y: -4, transition: transitions.exit },
};

/** Parent of a staggered list. */
export const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};

/** Child of a staggered list. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: transitions.enter },
};

/** Opacity-only variants used when the person prefers reduced motion. */
export const fadeOnly: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: duration.fast } },
  exit: { opacity: 0, transition: { duration: duration.fast } },
};

/** Picks the full variants or the opacity-only variants based on the OS setting. */
export function useMotionVariants(full: Variants, reduced: Variants = fadeOnly): Variants {
  const prefersReduced = useReducedMotion();
  return prefersReduced ? reduced : full;
}

export { useReducedMotion };
