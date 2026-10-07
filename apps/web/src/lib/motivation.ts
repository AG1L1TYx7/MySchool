/** Private motivation (docs/12 section 4): shapes of GET /me/motivation, /students/{id}/motivation and friends. */

export interface Badge {
  code: string;
  name: string;
  description: string;
  category: string;
  tier: number;
  icon: string;
  teacherAwarded: boolean;
  earnedAt: string;
  reason: string | null;
  awardedBy: { firstName: string; lastName: string } | null;
}

export interface Quest {
  id: string;
  title: string;
  description: string | null;
  metric: string;
  goal: number;
  rewardXp: number;
  startsAt: string;
  endsAt: string;
  status: 'active' | 'completed' | 'expired';
  kind: 'personal' | 'class';
  auto: boolean;
  classId: string | null;
  className: string | null;
  progress: number;
  classTotal: number | null;
  participants?: number;
}

export interface MotivationSummary {
  enabled: boolean;
  student: { id: string; firstName: string; lastName: string };
  xp: number;
  level: number;
  title: string;
  levelStartXp: number;
  nextLevelXp: number;
  todayXp: number;
  streak: { days: number; longest: number; alive: boolean; freezeTokens: number; lastActionOn: string | null };
  badges: Badge[];
  quests: Quest[];
  recent: Array<{ id: string; reason: string; amount: number; note: string | null; entityType: string; createdAt: string }>;
}

export interface RewardOutcome {
  granted: number;
  level: number;
  leveledUp: boolean;
  badges: string[];
  streakDays: number;
}

export interface CourseProgress {
  course: { id: string; title: string };
  student: { id: string; firstName: string; lastName: string };
  modules: Array<{ id: string; title: string; total: number; completed: number; lessons: Array<{ id: string; title: string; completed: boolean; completedAt: string | null }> }>;
  totalLessons: number;
  completedLessons: number;
  percent: number;
  nextLessonId: string | null;
}

export interface ClassConsole {
  class: { id: string; name: string };
  enabled: boolean;
  students: Array<{ id: string; firstName: string; lastName: string; xp: number; level: number; title: string; streakDays: number; longestStreak: number; freezeTokens: number; lastActionOn: string | null; badges: number; onTimeSubmissions: number; nearMilestone: boolean }>;
  streaks: { active: number; total: number };
  quests: Quest[];
  badges: Array<{ code: string; name: string; description: string; icon: string }>;
}

export const QUEST_METRICS = ['lessons', 'submissions', 'on_time', 'practice', 'xp'] as const;
