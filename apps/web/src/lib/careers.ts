/** Careers and portfolio (docs/02 sections 28 and 34, slice 24). */

export type PortfolioVisibility = 'private' | 'family' | 'school' | 'public';
export type ProjectKind = 'project' | 'writing' | 'art' | 'code' | 'science' | 'service' | 'other';

export interface Media {
  id: string;
  fileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  caption: string | null;
}
export interface Review {
  id: string;
  by: string;
  role: string;
  comment: string;
  stars: number | null;
  mine: boolean;
  createdAt: string;
}
export interface Project {
  id: string;
  title: string;
  summary: string | null;
  description: string | null;
  kind: ProjectKind;
  status: 'draft' | 'published';
  featured: boolean;
  skills: string[];
  reflection: string | null;
  externalUrl: string | null;
  completedOn: string | null;
  evidence: { submissionId: string; title: string } | null;
  media: Media[];
  reviews: Review[];
}
export interface Endorsement {
  by: string;
  role: string;
  comment: string | null;
  at: string;
}
export interface StudentSkill {
  skillId: string;
  name: string;
  category: string;
  level: number;
  levelName: string;
  note: string | null;
  endorsements: Endorsement[];
}
export interface Portfolio {
  id: string;
  studentId: string;
  student: { firstName: string; lastName: string; gradeLevel: string | null };
  headline: string | null;
  about: string | null;
  visibility: PortfolioVisibility;
  slug: string | null;
  publicPath: string | null;
  own: boolean;
  canReview: boolean;
  projects: Project[];
  skills: StudentSkill[];
}
export interface SkillDef {
  id: string;
  name: string;
  category: string;
  description: string | null;
  schoolOwned: boolean;
}
export interface Evidence {
  id: string;
  title: string;
  className: string;
  submittedAt: string;
  grade: { percentage: number; letter: string | null } | null;
}
export interface Career {
  student: { id: string; firstName: string; lastName: string; gradeLevel: string | null };
  goals: string | null;
  interests: { scores: Record<string, number>; top: string[]; code: string; names: string[]; takenAt: string | null; clusters: Array<{ id: string; name: string; examples: string[]; fit: number }> } | null;
  pathways: Array<{ id: string; name: string }>;
  collegePlans: Array<{ name: string; status: string; deadline?: string; note?: string }>;
  checklist: Array<{ key: string; label: string; who: 'student' | 'counselor'; done: boolean; doneAt: string | null }>;
  readiness: number;
  canCounsel: boolean;
  own: boolean;
}
export interface Inventory {
  questions: Array<{ id: string; text: string }>;
  scale: number[];
  codes: Record<string, string>;
}
export interface Cluster {
  id: string;
  name: string;
  codes: string[];
  examples: string[];
}
export interface CodeLessonSummary {
  id: string;
  title: string;
  level: number;
  language: string;
  tests: number;
  schoolOwned: boolean;
  bestPassed: number | null;
  attempts: number;
}
export interface CodeLesson {
  id: string;
  title: string;
  description: string;
  language: string;
  level: number;
  starter: string;
  tests: Array<{ label: string; expected: string }>;
  lastSubmission: { source: string; status: string; passed: number; total: number; output: string | null; createdAt: string } | null;
  available: boolean;
}
export interface RunResult {
  status: 'passed' | 'failed' | 'error';
  passed: number;
  total: number;
  outcomes: Array<{ label: string; passed: boolean; expected: string; got: string }>;
  output: string;
  error: string | null;
  runtimeMs: number;
}
export interface PublicPortfolio {
  name: string;
  gradeLevel: string | null;
  school: string;
  headline: string | null;
  about: string | null;
  projects: Array<{ id: string; title: string; summary: string | null; description: string | null; kind: ProjectKind; skills: string[]; completedOn: string | null; externalUrl: string | null; media: Array<{ fileId: string; name: string; mimeType: string; caption: string | null }> }>;
  skills: Array<{ name: string; level: number; levelName: string; endorsements: number }>;
}

export const KIND_LABELS: Record<ProjectKind, string> = { project: 'Project', writing: 'Writing', art: 'Art', code: 'Code', science: 'Science', service: 'Service', other: 'Other' };
export const VISIBILITY_LABELS: Record<PortfolioVisibility, string> = { private: 'Only me, my family and my teachers', family: 'My family and teachers', school: 'Everyone at my school', public: 'Anyone with the link' };
export const LEVEL_LABELS: Record<number, string> = { 1: 'Emerging', 2: 'Developing', 3: 'Proficient', 4: 'Advanced' };
export const PLAN_STATUSES = ['interested', 'applied', 'accepted', 'enrolled', 'declined'] as const;
