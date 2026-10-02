'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Celebration, ProgressBar, Skeleton } from '@/components/motion';
import { Alert, Button } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { loadH5pRuntime, type PlayResult, type PlayTicket, type XapiStatement } from '@/lib/h5p';

export interface H5pPlayerProps {
  contentId: string;
  /** When set, a completed play is posted to this assignment as a submission and grade. */
  assignmentId?: string;
  /** Teachers previewing their own content: results are recorded but not graded. */
  preview?: boolean;
  onResult?: (result: PlayResult) => void;
}

/**
 * Plays interactive content with the standalone H5P runtime and posts the result once (docs/12: progress
 * is real, the celebration is short and skippable, and a failure to post is shown rather than hidden).
 */
export function H5pPlayer({ contentId, assignmentId, preview, onResult }: H5pPlayerProps) {
  const host = useRef<HTMLDivElement>(null);
  const [ticket, setTicket] = useState<PlayTicket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [score, setScore] = useState<{ raw: number; max: number } | null>(null);
  const [posted, setPosted] = useState<PlayResult | null>(null);
  const [posting, setPosting] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const started = useRef(Date.now());
  const postedRef = useRef(false);

  const post = useCallback(
    async (raw: number, max: number, detail?: XapiStatement) => {
      if (postedRef.current) return;
      postedRef.current = true;
      setPosting(true);
      try {
        const body: Record<string, unknown> = { score: raw, maxScore: max, completed: true, timeSpentSeconds: Math.round((Date.now() - started.current) / 1000), detail };
        if (assignmentId && !preview) body.assignmentId = assignmentId;
        const result = await api<PlayResult>(`/h5p/contents/${contentId}/results`, { method: 'POST', body });
        setPosted(result);
        setCelebrate(true);
        onResult?.(result);
      } catch (err) {
        postedRef.current = false;
        setError(errorMessage(err));
      } finally {
        setPosting(false);
      }
    },
    [assignmentId, contentId, onResult, preview],
  );

  useEffect(() => {
    let cancelled = false;
    let handler: ((e: { data: { statement: XapiStatement } }) => void) | null = null;
    (async () => {
      try {
        const t = await api<PlayTicket>(`/h5p/contents/${contentId}/play${assignmentId ? `?assignmentId=${assignmentId}` : ''}`);
        if (cancelled) return;
        setTicket(t);
        const runtime = await loadH5pRuntime();
        if (cancelled || !host.current) return;
        host.current.innerHTML = '';
        await new runtime.H5P(host.current, { h5pJsonPath: t.h5pJsonPath, frameJs: '/h5p/frame.bundle.js', frameCss: '/h5p/styles/h5p.css', librariesPath: '/h5p/libraries', copyright: false, embed: false, fullScreen: true });
        if (cancelled) return;
        setReady(true);
        handler = (e) => {
          const s = e.data.statement;
          const verb = s.verb?.id.split('/').pop();
          const hasParent = (s.context?.contextActivities?.parent?.length ?? 0) > 0;
          if (s.result?.score && typeof s.result.score.raw === 'number' && typeof s.result.score.max === 'number' && !hasParent) {
            setScore({ raw: s.result.score.raw, max: s.result.score.max });
            if (verb === 'completed') void post(s.result.score.raw, s.result.score.max, s);
          } else if (verb === 'completed' && !hasParent && s.result?.score === undefined) {
            void post(t.maxScore, t.maxScore, s);
          }
        };
        window.H5P?.externalDispatcher.on('xAPI', handler);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
      if (handler) window.H5P?.externalDispatcher.off('xAPI', handler);
    };
  }, [contentId, assignmentId, post]);

  return (
    <div className="space-y-3">
      <Celebration show={celebrate} title={posted?.grade ? `Scored ${posted.grade.score} of ${posted.grade.maxPoints}` : 'Finished!'} message={posted ? `${posted.percentage}% on ${ticket?.title ?? 'this activity'}${posted.grade ? ' and your grade is posted.' : '.'}` : undefined} onDone={() => setCelebrate(false)} />
      {error && <Alert>{error}</Alert>}
      {!ready && !error && (
        <div className="space-y-2">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
      <div ref={host} className={ready ? 'rounded-lg border border-slate-200 bg-white p-2' : 'hidden'} />
      {ready && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="min-w-[200px] flex-1">
            {score ? <ProgressBar value={score.raw} max={score.max} label={`${score.raw} of ${score.max} so far`} tone={score.raw === score.max ? 'green' : 'brand'} /> : <span className="text-slate-500">Work through the activity; your score posts when you finish.</span>}
          </div>
          {!posted && score && (
            <Button variant="secondary" loading={posting} onClick={() => void post(score.raw, score.max)}>
              I&apos;m done, record my score
            </Button>
          )}
          {posted && <span className="text-green-700">Recorded: {posted.percentage}%{posted.grade ? ` · grade ${posted.grade.score}/${posted.grade.maxPoints}` : ''}</span>}
        </div>
      )}
    </div>
  );
}
