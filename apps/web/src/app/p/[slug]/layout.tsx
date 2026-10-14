import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** A student's public page is shareable by link but never indexed by search engines (docs/21 F35). */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function PublicPortfolioLayout({ children }: { children: ReactNode }) {
  return children;
}
