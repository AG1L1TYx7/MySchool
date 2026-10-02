import Link from 'next/link';
import { Card } from '@/components/ui';

/** Shown when a page exists but the signed-in role has no access to it, without calling the API. */
export function NotForYou({ what, back, alt }: { what: string; back: string; alt?: { href: string; label: string } }) {
  return (
    <div className="mx-auto max-w-2xl">
      <Card title="Not available for your account" description={`Only school staff can open ${what}.`}>
        <p className="text-sm text-slate-600">
          <Link href={back} className="text-brand-700 hover:underline">
            Back to the class
          </Link>
          {alt && (
            <>
              {' · '}
              <Link href={alt.href} className="text-brand-700 hover:underline">
                See {alt.label}
              </Link>
            </>
          )}
        </p>
      </Card>
    </div>
  );
}
