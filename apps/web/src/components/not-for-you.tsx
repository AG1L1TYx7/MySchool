import Link from 'next/link';
import { Card } from '@/components/ui';

/** Shown when a page exists but the signed-in role has no access to it, without calling the API. */
export function NotForYou({ what, back, alt }: { what: string; back: string; alt?: { href: string; label: string } }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">Not available for your account</h1>
      <Card>
        <p className="text-sm text-slate-500">{`Only school staff can open ${what}.`}</p>
        <p className="mt-2 text-sm text-slate-600">
          <Link href={back} className="text-brand-700 underline">
            {back === '/dashboard' ? 'Back to the dashboard' : 'Back to the class'}
          </Link>
          {alt && (
            <>
              {' · '}
              <Link href={alt.href} className="text-brand-700 underline">
                See {alt.label}
              </Link>
            </>
          )}
        </p>
      </Card>
    </div>
  );
}
