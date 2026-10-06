import { api } from './api';

/** One child on the family home (GET /family/home). */
export interface ChildHome {
  student: { id: string; studentNumber: string; firstName: string; lastName: string; gradeLevel: string | null };
  classes: Array<{ id: string; name: string; courseTitle: string; teacher: string | null; percentage: number | null; letter: string | null }>;
  attendance: { rate: number | null; daysPresent: number; daysAbsent: number; tardies: number };
  missing: Array<{ assignmentId: string; title: string; className: string; dueAt: string | null }>;
  upcoming: Array<{ assignmentId: string; title: string; className: string; dueAt: string | null }>;
  recentGrades: Array<{ assignmentId: string; title: string; className: string; score: number; maxPoints: number; percentage: number; gradedAt: string }>;
  behaviorNotes: number;
  reportCards: number;
}

export interface LessonSummary {
  id: string;
  lessonId: string;
  language: string;
  title: string;
  summary: string;
  keyIdeas: string[];
  questions: string[];
  tryAtHome: string[];
  status: 'draft' | 'released';
  aiGenerated: boolean;
  aiModel: string | null;
  reviewedBy: { id: string; firstName: string; lastName: string } | null;
  releasedAt: string | null;
  updatedAt: string;
}

export interface ConferenceNote {
  id: string;
  studentId: string;
  language: string;
  content: { opening: string; strengths: string[]; concerns: string[]; talkingPoints: string[]; questionsForFamily: string[]; nextSteps: string[] };
  aiModel: string | null;
  author: { id: string; firstName: string; lastName: string };
  createdAt: string;
}

export interface AiJob {
  id: string;
  capability: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  progress: string | null;
  resultId: string | null;
  error: { code: string; detail: string } | null;
}

/** Polls an AI job until it finishes; resolves with the final job, rejects with its error detail on failure. */
export async function waitForJob(id: string, { every = 1500, timeout = 120_000 }: { every?: number; timeout?: number } = {}): Promise<AiJob> {
  const started = Date.now();
  for (;;) {
    const job = await api<AiJob>(`/ai/jobs/${id}`);
    if (job.status === 'done') return job;
    if (job.status === 'failed') throw new Error(job.error?.detail ?? job.error?.code ?? 'failed');
    if (Date.now() - started > timeout) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, every));
  }
}

export const LANGUAGE_NAMES: Record<string, { en: string; es: string }> = {
  en: { en: 'English', es: 'inglés' },
  es: { en: 'Spanish', es: 'español' },
};
