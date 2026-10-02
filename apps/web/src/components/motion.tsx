'use client';

import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { duration, fadeOnly, fadeRise, spring, stagger, staggerItem, useMotionVariants, useReducedMotion } from '@/lib/motion';

/**
 * Wraps a page: fade and rise on route change, exit on leave. Keyed by the route in the app layout.
 * The very first render is painted visible, so the server-rendered page is readable before hydration
 * (largest contentful paint must not wait for JavaScript).
 */
let hydratedOnce = false;
export function MotionPage({ children, className }: { children: ReactNode; className?: string }) {
  const variants = useMotionVariants(fadeRise);
  const [animateIn] = useState(() => hydratedOnce);
  useEffect(() => {
    hydratedOnce = true;
  }, []);
  return (
    <motion.div variants={variants} initial={animateIn ? 'hidden' : false} animate="visible" exit="exit" className={className}>
      {children}
    </motion.div>
  );
}

/** Staggered list container; use MotionItem for each child. */
export function MotionList({ children, className, as = 'ul' }: { children: ReactNode; className?: string; as?: 'ul' | 'div' }) {
  const prefersReduced = useReducedMotion();
  const Tag = as === 'ul' ? motion.ul : motion.div;
  return (
    <Tag variants={prefersReduced ? undefined : stagger} initial="hidden" animate="visible" className={className}>
      {children}
    </Tag>
  );
}

export function MotionItem({ children, className, as = 'li', layout = true }: { children: ReactNode; className?: string; as?: 'li' | 'div'; layout?: boolean }) {
  const variants = useMotionVariants(staggerItem, fadeOnly);
  const Tag = as === 'li' ? motion.li : motion.div;
  return (
    <Tag variants={variants} layout={layout} className={className}>
      {children}
    </Tag>
  );
}

/** Skeleton block for loading states; sized by the caller, shimmer via Tailwind's pulse. */
export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-slate-200/80 ${className}`} />;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Number that counts from its previous value to the new one. */
export function CountUp({ value, decimals = 0, suffix = '', className }: { value: number; decimals?: number; suffix?: string; className?: string }) {
  const prefersReduced = useReducedMotion();
  const mv = useMotionValue(value);
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);
  useEffect(() => {
    if (prefersReduced) {
      setDisplay(value);
      previous.current = value;
      return;
    }
    const controls = animate(mv, value, { duration: duration.slow, ease: 'easeOut', onUpdate: (v) => setDisplay(v) });
    previous.current = value;
    return () => controls.stop();
  }, [value, mv, prefersReduced]);
  return (
    <span className={className}>
      {display.toFixed(decimals)}
      {suffix}
    </span>
  );
}

/** Horizontal progress bar animating from the previous fill to the new one. */
export function ProgressBar({ value, max = 100, label, tone = 'brand' }: { value: number; max?: number; label?: string; tone?: 'brand' | 'green' | 'amber' }) {
  const prefersReduced = useReducedMotion();
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const color = { brand: 'bg-brand-600', green: 'bg-green-600', amber: 'bg-amber-500' }[tone];
  return (
    <div className="w-full" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <motion.div className={`h-full rounded-full ${color}`} initial={false} animate={{ width: `${pct}%` }} transition={prefersReduced ? { duration: 0 } : spring.soft} />
      </div>
    </div>
  );
}

/** Circular progress ring with a count-up centre. */
export function ProgressRing({ value, max = 100, size = 96, stroke = 10, label, suffix = '%', tone = 'brand' }: { value: number; max?: number; size?: number; stroke?: number; label?: string; suffix?: string; tone?: 'brand' | 'green' | 'amber' }) {
  const prefersReduced = useReducedMotion();
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const progress = useMotionValue(0);
  const dash = useTransform(progress, (p) => c * (1 - p / 100));
  useEffect(() => {
    const controls = animate(progress, pct, prefersReduced ? { duration: 0 } : { ...spring.soft });
    return () => controls.stop();
  }, [pct, progress, prefersReduced]);
  const color = { brand: 'stroke-brand-600', green: 'stroke-green-600', amber: 'stroke-amber-500' }[tone];
  return (
    <div className="inline-flex flex-col items-center" role="img" aria-label={`${label ?? 'Progress'}: ${Math.round(pct)}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="fill-none stroke-slate-200" />
        <motion.circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} strokeLinecap="round" className={`fill-none ${color}`} strokeDasharray={c} style={{ strokeDashoffset: dash }} />
      </svg>
      <div className="-mt-[calc(50%+0.75rem)] mb-[calc(50%-0.75rem)] text-center text-sm font-semibold text-slate-900">
        <CountUp value={pct} suffix={suffix} />
      </div>
      {label && <span className="mt-1 text-xs text-slate-500">{label}</span>}
    </div>
  );
}

/**
 * A short, skippable celebration (docs/12: at most 1.2 s, never stacked, never blocking).
 * With reduced motion it degrades to a plain success message.
 */
export function Celebration({ show, title, message, onDone }: { show: boolean; title: string; message?: string; onDone: () => void }) {
  const prefersReduced = useReducedMotion();
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(onDone, prefersReduced ? 1800 : duration.celebrate * 1000 + 600);
    return () => clearTimeout(t);
  }, [show, onDone, prefersReduced]);
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 top-6 z-50 flex justify-center"
          initial={{ opacity: 0, y: -12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8 }}
          transition={prefersReduced ? { duration: 0.1 } : spring.soft}
        >
          <div className="pointer-events-auto relative overflow-hidden rounded-xl bg-white px-5 py-3 shadow-lg ring-1 ring-brand-200">
            {!prefersReduced && <Confetti />}
            <p className="font-semibold text-slate-900">{title}</p>
            {message && <p className="text-sm text-slate-600">{message}</p>}
            <button className="absolute right-2 top-1 text-xs text-slate-400 hover:text-slate-600" onClick={onDone} aria-label="Dismiss">
              ✕
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const CONFETTI_COLORS = ['#325fff', '#16a34a', '#f59e0b', '#ec4899', '#8b5cf6'];

function Confetti() {
  const pieces = Array.from({ length: 18 }, (_, i) => ({ i, x: (i / 18) * 100, delay: (i % 6) * 0.05, color: CONFETTI_COLORS[i % CONFETTI_COLORS.length], rotate: (i * 47) % 360 }));
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p) => (
        <motion.span
          key={p.i}
          className="absolute top-0 block h-2 w-1.5 rounded-sm"
          style={{ left: `${p.x}%`, backgroundColor: p.color }}
          initial={{ y: -10, opacity: 1, rotate: 0 }}
          animate={{ y: 90, opacity: 0, rotate: p.rotate }}
          transition={{ duration: duration.celebrate, delay: p.delay, ease: 'easeIn' }}
        />
      ))}
    </div>
  );
}

/** Pill selector whose highlight slides between options (attendance statuses, filters). */
export function PillGroup<T extends string>({ options, value, onChange, labels, name }: { options: readonly T[]; value: T; onChange: (v: T) => void; labels?: (v: T) => string; name: string }) {
  const prefersReduced = useReducedMotion();
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-1">
      {options.map((o) => {
        const active = o === value;
        return (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o)}
            className={`relative rounded-full px-2.5 py-0.5 text-xs ring-1 ring-inset transition-colors duration-150 ${active ? 'text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}
          >
            {active && <motion.span layoutId={`${name}-pill`} className="absolute inset-0 rounded-full bg-brand-600" transition={prefersReduced ? { duration: 0 } : spring.soft} />}
            <span className="relative">{labels ? labels(o) : o}</span>
          </button>
        );
      })}
    </div>
  );
}
