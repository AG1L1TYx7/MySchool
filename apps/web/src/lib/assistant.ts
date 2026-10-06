/** Teacher assistant (docs/13 section 8): shapes of the /assistant routes. */

export interface PlanPhase {
  phase: string;
  minutes: number;
  teacherDoes: string;
  studentsDo: string;
}
export interface PlanContent {
  title?: string;
  objectives?: string[];
  materials?: string[];
  sequence?: PlanPhase[];
  differentiation?: { support?: string; extension?: string };
  exitCheck?: Array<{ question: string; answer: string }>;
}
export interface LessonPlan {
  id: string;
  title: string;
  topic: string;
  durationMinutes: number;
  gradeLevel: string | null;
  subject: string | null;
  standardCodes: string | null;
  status: 'draft' | 'published';
  scheduledOn: string | null;
  classId: string | null;
  className: string | null;
  courseId: string | null;
  lessonId: string | null;
  content: PlanContent;
  aiGenerated: boolean;
  author: { id: string; firstName: string; lastName: string };
  updatedAt: string;
}

export interface Suggestion {
  id: string;
  submissionId: string;
  student: { id: string; firstName: string; lastName: string };
  excerpt: string;
  attemptNumber: number;
  isLate: boolean;
  content: { criteria?: Array<{ criterionId: string; score: number; maxPoints: number; evidence?: string; feedback?: string; confidence: number }>; summary?: string; flag?: string | null };
  score: number;
  maxPoints: number;
  suggestedPoints: number;
  confidence: number;
  needsHumanReview: boolean;
  flag: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy: { firstName: string; lastName: string } | null;
  reviewedAt: string | null;
  alreadyGraded: boolean;
}
export interface SuggestionList {
  assignment: { id: string; title: string; maxPoints: number; hasRubric: boolean };
  data: Suggestion[];
}

export interface Draft {
  id: string;
  kind: 'parent_email' | 'narrative' | 'differentiation' | string;
  title: string;
  language: string;
  status: string;
  studentId: string | null;
  studentName: string | null;
  lessonId: string | null;
  classId: string | null;
  content: Record<string, unknown>;
  aiGenerated: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface EmailContent {
  subject?: string;
  greeting?: string;
  body?: string[];
  closing?: string;
  signature?: string;
}
export interface NarrativeContent {
  narrative?: string;
  strengths?: string[];
  growthAreas?: string[];
  nextSteps?: string[];
}
export interface DifferentiationContent {
  levels?: Array<{ level: string; title: string; readingLevel?: string; text: string; keyWords?: string[]; questions?: Array<{ prompt: string; answer: string }> }>;
}

export interface Insight {
  id: string;
  classId: string;
  weekStart: string;
  data: {
    students?: number;
    tutor?: { studentsWhoUsedIt: number; conversationsThisWeek: number; conversationsLastWeek: number; refusals: number; topTopics: Array<{ topic: string; conversations: number }> };
    work?: { assignmentsDueLast14Days: number; missingItems: number; submissionsThisWeek: number; averageScoreRecent: number | null; lowScoringAssignments: Array<{ title: string; average: number | null }> };
    attendance?: { recordsThisWeek: number; presentRate: number | null };
    classAverage?: number | null;
    lessonsCompletedThisWeek?: number;
  };
  narrative: { headline?: string; observations?: string[]; actions?: string[]; caveats?: string } | null;
  practiceContentId: string | null;
  aiGenerated: boolean;
  updatedAt: string;
}

export interface Substitute {
  id: string;
  user: { id: string; firstName: string; lastName: string; email: string; role: string };
  startsAt: string;
  endsAt: string;
  note: string | null;
  active: boolean;
  grantedBy?: { firstName: string; lastName: string };
}

export interface PlannerWeek {
  weekStart: string;
  classes: Array<{ id: string; name: string; period: string | null }>;
  days: Array<{ date: string; items: Array<{ kind: 'assignment' | 'plan' | 'event' | 'term'; id: string; title: string; time: string | null; classId: string | null; className: string | null; link: string | null; detail: string | null }> }>;
}
