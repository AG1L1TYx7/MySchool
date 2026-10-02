/** Interactive content (H5P) and AI content jobs: types and the player loader (docs/09, docs/07 slice 6). */

export interface H5pContentSummary {
  id: string;
  organizationId: string;
  title: string;
  library: string;
  contentType: string;
  status: 'draft' | 'published' | 'archived';
  source: 'ai' | 'manual';
  maxScore: number;
  subject: string | null;
  gradeLevel: string | null;
  topic: string | null;
  difficulty: string | null;
  courseId: string | null;
  lessonId: string | null;
  aiModel: string | null;
  promptVersion: string | null;
  createdBy: { id: string; firstName: string; lastName: string } | null;
  assignmentCount: number;
  resultCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface H5pContentDetail extends H5pContentSummary {
  parameters: Record<string, unknown>;
  draft: QuizDraft | FlashcardsDraft | null;
  validation: { valid: boolean; errors: string[] };
}

export interface QuizQuestion {
  type: 'multiple_choice' | 'true_false' | 'fill_blank';
  prompt: string;
  options: string[];
  answer: string;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  sourceIds: string[];
}
export interface QuizDraft {
  title: string;
  questions: QuizQuestion[];
}
export interface Flashcard {
  front: string;
  back: string;
  hint: string | null;
}
export interface FlashcardsDraft {
  title: string;
  cards: Flashcard[];
}

export function isQuizDraft(d: QuizDraft | FlashcardsDraft | null): d is QuizDraft {
  return !!d && Array.isArray((d as QuizDraft).questions);
}

export interface ContentJob {
  id: string;
  capability: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  progress: string | null;
  contentId: string | null;
  content?: H5pContentSummary | null;
  error: { code: string; detail: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlayTicket {
  ticket: string;
  h5pJsonPath: string;
  title: string;
  library: string;
  maxScore: number;
  expiresAt: string;
}

export interface PlayResult {
  id: string;
  score: number;
  maxScore: number;
  percentage: number;
  completed: boolean;
  submission: { id: string; status: string; attemptNumber: number; isLate: boolean } | null;
  grade: { score: number; maxPoints: number; percentage: number; letterGrade: string | null } | null;
}

export const CONTENT_TYPE_LABELS: Record<string, string> = { quiz: 'Quiz', flashcards: 'Flashcards', multiple_choice: 'Multiple choice', true_false: 'True or false', fill_blanks: 'Fill in the blanks' };

// ---------------------------------------------------------------------------
// Player runtime (h5p-standalone, served from /h5p after `pnpm h5p:setup`)
// ---------------------------------------------------------------------------

export interface XapiStatement {
  verb: { id: string };
  object?: { id?: string; definition?: { name?: Record<string, string> } };
  result?: { score?: { raw?: number; max?: number; scaled?: number }; completion?: boolean; success?: boolean };
  context?: { contextActivities?: { parent?: unknown[] } };
}

interface H5pStandaloneGlobal {
  H5P: new (el: HTMLElement, options: Record<string, unknown>) => Promise<unknown>;
}
interface H5pCoreGlobal {
  externalDispatcher: { on: (event: string, fn: (e: { data: { statement: XapiStatement } }) => void) => void; off: (event: string, fn: (e: { data: { statement: XapiStatement } }) => void) => void };
}

declare global {
  interface Window {
    H5PStandalone?: H5pStandaloneGlobal;
    H5P?: H5pCoreGlobal;
  }
}

let runtime: Promise<H5pStandaloneGlobal> | null = null;

/** Loads /h5p/main.bundle.js once; rejects with a clear message when the libraries were never installed. */
export function loadH5pRuntime(): Promise<H5pStandaloneGlobal> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.H5PStandalone) return Promise.resolve(window.H5PStandalone);
  if (!runtime) {
    runtime = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/h5p/main.bundle.js';
      script.async = true;
      script.onload = () => (window.H5PStandalone ? resolve(window.H5PStandalone) : reject(new Error('The H5P player did not initialise.')));
      script.onerror = () => {
        runtime = null;
        reject(new Error('The interactive player is not installed on this server (run `pnpm h5p:setup`).'));
      };
      document.head.appendChild(script);
    });
  }
  return runtime;
}
