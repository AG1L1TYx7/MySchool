'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/ui';
import { api } from '@/lib/api';
import { KIND_LABELS, LEVEL_LABELS, type PublicPortfolio } from '@/lib/careers';

/** A student's public portfolio page: published projects and skills only, no sign-in, no grades. */
export default function PublicPortfolioPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<PublicPortfolio | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    api<PublicPortfolio>(`/p/${encodeURIComponent(slug)}`, { auth: false })
      .then(setData)
      .catch(() => setMissing(true));
  }, [slug]);
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <Logo className="text-lg" />
      </div>
      {missing ? (
        <div>
          <h1 className="text-2xl font-semibold">No portfolio here</h1>
          <p className="mt-2 text-sm text-slate-600">This address is not shared, or the portfolio was made private.</p>
        </div>
      ) : !data ? (
        <p className="text-sm text-slate-600">Loading…</p>
      ) : (
        <article className="space-y-6">
          <header>
            <h1 className="text-3xl font-semibold">{data.name}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {data.school}
              {data.gradeLevel ? ` · grade ${data.gradeLevel}` : ''}
            </p>
            {data.headline && <p className="mt-2 text-lg">{data.headline}</p>}
            {data.about && <p className="mt-2 text-sm text-slate-700">{data.about}</p>}
          </header>
          {data.skills.length > 0 && (
            <section aria-labelledby="skills-h">
              <h2 id="skills-h" className="text-lg font-semibold">
                Skills
              </h2>
              <ul className="mt-2 flex flex-wrap gap-2">
                {data.skills.map((s) => (
                  <li key={s.name} className="rounded-full bg-slate-100 px-3 py-1 text-sm">
                    {s.name} · {LEVEL_LABELS[s.level]}
                    {s.endorsements ? ` · ${s.endorsements} endorsed` : ''}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="projects-h" className="space-y-4">
            <h2 id="projects-h" className="text-lg font-semibold">
              Projects
            </h2>
            {data.projects.length === 0 && <p className="text-sm text-slate-600">Nothing published yet.</p>}
            {data.projects.map((p) => (
              <div key={p.id} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <h3 className="font-semibold">{p.title}</h3>
                <p className="text-xs text-slate-600">
                  {KIND_LABELS[p.kind]}
                  {p.completedOn ? ` · ${new Date(p.completedOn).toLocaleDateString()}` : ''}
                </p>
                {p.summary && <p className="mt-2 text-sm">{p.summary}</p>}
                {p.description && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{p.description}</p>}
                {p.skills.length > 0 && <p className="mt-2 text-xs text-slate-600">Skills: {p.skills.join(', ')}</p>}
                {p.externalUrl && (
                  <a href={p.externalUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-brand-700 hover:underline">
                    Open the link
                  </a>
                )}
                {p.media.length > 0 && <p className="mt-2 text-xs text-slate-600">{p.media.length} attached file{p.media.length === 1 ? '' : 's'} (sign in to download)</p>}
              </div>
            ))}
          </section>
          <footer className="text-xs text-slate-500">Published with SmartSchool. Only what the student chose to publish is shown.</footer>
        </article>
      )}
    </main>
  );
}
