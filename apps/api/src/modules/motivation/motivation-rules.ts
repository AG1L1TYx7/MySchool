/**
 * Pure rules for private motivation (docs/12 section 4, docs/02 section 14, ADR-024): XP amounts, levels,
 * titles, streaks with freeze tokens, the badge catalogue with its criteria, and weekly quests.
 * Nothing here ranks students against each other.
 */

export const XP = {
  LESSON_COMPLETED: 10,
  ASSIGNMENT_SUBMITTED: 20,
  ON_TIME_BONUS: 10,
  SCORE_IMPROVED: 15,
  PERFECT_SCORE: 25,
  PRACTICE: 10,
} as const;

export type XpReason =
  | 'lesson.completed'
  | 'assignment.submitted'
  | 'assignment.on_time'
  | 'score.improved'
  | 'score.perfect'
  | 'practice.completed'
  | 'quest.completed'
  | 'teacher.award';

/** XP granted by automatic rules in one calendar day is capped; teacher awards and quest rewards are not. */
export const DAILY_AUTO_XP_CAP = 200;
export const MAX_FREEZE_TOKENS = 2;
export const FREEZE_EVERY_DAYS = 5;
export const MAX_TEACHER_AWARD = 100;

/** Cumulative XP needed to reach a level; grows geometrically (100, 250, 475, 813, ...). */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round(200 * (Math.pow(1.5, level - 1) - 1));
}

export function levelFor(xp: number): number {
  let level = 1;
  while (level < 60 && xp >= xpForLevel(level + 1)) level += 1;
  return level;
}

export type TitleCode =
  'newcomer' | 'explorer' | 'scholar' | 'achiever' | 'champion' | 'legend';

export function titleFor(level: number): TitleCode {
  if (level >= 20) return 'legend';
  if (level >= 15) return 'champion';
  if (level >= 10) return 'achiever';
  if (level >= 6) return 'scholar';
  if (level >= 3) return 'explorer';
  return 'newcomer';
}

// ---------------------------------------------------------------------------
// Streaks: consecutive school days with at least one learning action
// ---------------------------------------------------------------------------

export interface StreakState {
  streakDays: number;
  longestStreak: number;
  /** ISO date (YYYY-MM-DD) of the last learning action, or null. */
  lastActionOn: string | null;
  freezeTokens: number;
  freezesUsed: number;
}

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
};

/** Weekends are not school days; the school calendar can refine this through `isSchoolDay`. */
export const weekday = (iso: string): boolean => {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
};

export function previousSchoolDay(
  iso: string,
  isSchoolDay: (d: string) => boolean = weekday,
): string {
  let d = addDays(iso, -1);
  for (let i = 0; i < 14 && !isSchoolDay(d); i++) d = addDays(d, -1);
  return d;
}

export interface StreakOutcome extends StreakState {
  extended: boolean;
  usedFreeze: boolean;
  earnedFreeze: boolean;
  reset: boolean;
}

/**
 * Applies a learning action on `today`. A missed school day resets the streak unless a freeze token
 * covers it (one token covers one missed day); tokens are earned every five consecutive days, up to two.
 */
export function advanceStreak(
  state: StreakState,
  today: string,
  isSchoolDay: (d: string) => boolean = weekday,
): StreakOutcome {
  const base: StreakOutcome = {
    ...state,
    extended: false,
    usedFreeze: false,
    earnedFreeze: false,
    reset: false,
  };
  if (state.lastActionOn === today) return base;
  if (state.lastActionOn && state.lastActionOn > today) return base;
  const prev = previousSchoolDay(today, isSchoolDay);
  const prev2 = previousSchoolDay(prev, isSchoolDay);
  let streakDays: number;
  let freezeTokens = state.freezeTokens;
  let freezesUsed = state.freezesUsed;
  let usedFreeze = false;
  let reset = false;
  if (!state.lastActionOn || state.streakDays === 0) {
    streakDays = 1;
  } else if (state.lastActionOn >= prev) {
    streakDays = state.streakDays + 1;
  } else if (state.lastActionOn >= prev2 && freezeTokens > 0) {
    freezeTokens -= 1;
    freezesUsed += 1;
    usedFreeze = true;
    streakDays = state.streakDays + 1;
  } else {
    streakDays = 1;
    reset = true;
  }
  const extended = streakDays > 1;
  let earnedFreeze = false;
  if (
    extended &&
    streakDays % FREEZE_EVERY_DAYS === 0 &&
    freezeTokens < MAX_FREEZE_TOKENS
  ) {
    freezeTokens += 1;
    earnedFreeze = true;
  }
  return {
    streakDays,
    longestStreak: Math.max(state.longestStreak, streakDays),
    lastActionOn: today,
    freezeTokens,
    freezesUsed,
    extended,
    usedFreeze,
    earnedFreeze,
    reset,
  };
}

/** A streak shown today: still alive if the last action was today or the previous school day (or coverable by a freeze). */
export function streakAlive(
  state: StreakState,
  today: string,
  isSchoolDay: (d: string) => boolean = weekday,
): boolean {
  if (!state.lastActionOn || state.streakDays === 0) return false;
  if (state.lastActionOn >= previousSchoolDay(today, isSchoolDay)) return true;
  const prev2 = previousSchoolDay(
    previousSchoolDay(today, isSchoolDay),
    isSchoolDay,
  );
  return state.lastActionOn >= prev2 && state.freezeTokens > 0;
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export type BadgeCategory =
  'curriculum' | 'habit' | 'growth' | 'streak' | 'level' | 'kindness';

export interface BadgeDef {
  code: string;
  name: string;
  description: string;
  category: BadgeCategory;
  tier: number;
  icon: string;
  /** Teacher-awarded badges have no automatic rule. */
  teacherAwarded?: boolean;
}

export interface BadgeStats {
  lessonsCompleted: number;
  modulesCompleted: number;
  onTimeSubmissions: number;
  improvedInARow: number;
  perfectScores: number;
  streakDays: number;
  longestStreak: number;
  level: number;
}

export const BADGES: readonly BadgeDef[] = [
  {
    code: 'first-steps',
    name: 'First steps',
    description: 'Finished your first lesson.',
    category: 'curriculum',
    tier: 1,
    icon: '🌱',
  },
  {
    code: 'bookworm',
    name: 'Bookworm',
    description: 'Finished ten lessons.',
    category: 'curriculum',
    tier: 2,
    icon: '📚',
  },
  {
    code: 'module-master',
    name: 'Module master',
    description: 'Finished every lesson in a module.',
    category: 'curriculum',
    tier: 2,
    icon: '🧩',
  },
  {
    code: 'module-master-5',
    name: 'Course climber',
    description: 'Finished every lesson in five modules.',
    category: 'curriculum',
    tier: 3,
    icon: '🏔️',
  },
  {
    code: 'on-time-5',
    name: 'Right on time',
    description: 'Five assignments turned in before the due date.',
    category: 'habit',
    tier: 1,
    icon: '⏰',
  },
  {
    code: 'on-time-20',
    name: 'Clockwork',
    description: 'Twenty assignments turned in before the due date.',
    category: 'habit',
    tier: 3,
    icon: '🕰️',
  },
  {
    code: 'growth-2',
    name: 'On the rise',
    description: 'Your score improved two assignments in a row.',
    category: 'growth',
    tier: 1,
    icon: '📈',
  },
  {
    code: 'growth-5',
    name: 'Unstoppable',
    description: 'Your score improved five assignments in a row.',
    category: 'growth',
    tier: 3,
    icon: '🚀',
  },
  {
    code: 'perfect-3',
    name: 'Bullseye',
    description: 'Three perfect scores.',
    category: 'growth',
    tier: 2,
    icon: '🎯',
  },
  {
    code: 'streak-7',
    name: 'One week strong',
    description: 'A learning streak of seven school days.',
    category: 'streak',
    tier: 1,
    icon: '🔥',
  },
  {
    code: 'streak-30',
    name: 'Marathon',
    description: 'A learning streak of thirty school days.',
    category: 'streak',
    tier: 3,
    icon: '🏅',
  },
  {
    code: 'level-5',
    name: 'Explorer',
    description: 'Reached level 5.',
    category: 'level',
    tier: 1,
    icon: '🧭',
  },
  {
    code: 'level-10',
    name: 'Achiever',
    description: 'Reached level 10.',
    category: 'level',
    tier: 2,
    icon: '⭐',
  },
  {
    code: 'kindness',
    name: 'Kindness',
    description: 'A teacher saw you help someone.',
    category: 'kindness',
    tier: 1,
    icon: '💛',
    teacherAwarded: true,
  },
  {
    code: 'helper',
    name: 'Helper',
    description: 'A teacher saw you go out of your way for the class.',
    category: 'kindness',
    tier: 2,
    icon: '🤝',
    teacherAwarded: true,
  },
  {
    code: 'leader',
    name: 'Leader',
    description: 'A teacher saw you lead by example.',
    category: 'kindness',
    tier: 3,
    icon: '🌟',
    teacherAwarded: true,
  },
];

const AUTO_RULES: Record<string, (s: BadgeStats) => boolean> = {
  'first-steps': (s) => s.lessonsCompleted >= 1,
  bookworm: (s) => s.lessonsCompleted >= 10,
  'module-master': (s) => s.modulesCompleted >= 1,
  'module-master-5': (s) => s.modulesCompleted >= 5,
  'on-time-5': (s) => s.onTimeSubmissions >= 5,
  'on-time-20': (s) => s.onTimeSubmissions >= 20,
  'growth-2': (s) => s.improvedInARow >= 2,
  'growth-5': (s) => s.improvedInARow >= 5,
  'perfect-3': (s) => s.perfectScores >= 3,
  'streak-7': (s) => s.longestStreak >= 7,
  'streak-30': (s) => s.longestStreak >= 30,
  'level-5': (s) => s.level >= 5,
  'level-10': (s) => s.level >= 10,
};

/** Badge codes the stats now satisfy that the student does not have yet. */
export function newlyEarnedBadges(
  stats: BadgeStats,
  owned: ReadonlySet<string>,
): string[] {
  return BADGES.filter(
    (b) =>
      !b.teacherAwarded && !owned.has(b.code) && AUTO_RULES[b.code]?.(stats),
  ).map((b) => b.code);
}

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

export type QuestMetric =
  'lessons' | 'submissions' | 'on_time' | 'practice' | 'xp';
export const QUEST_METRICS: readonly QuestMetric[] = [
  'lessons',
  'submissions',
  'on_time',
  'practice',
  'xp',
];

export interface LearningAction {
  kind: 'lesson' | 'submission' | 'practice' | 'xp';
  onTime?: boolean;
  amount?: number;
}

/** How much one action moves a quest with the given metric. */
export function questIncrement(metric: string, action: LearningAction): number {
  switch (metric) {
    case 'lessons':
      return action.kind === 'lesson' ? 1 : 0;
    case 'submissions':
      return action.kind === 'submission' ? 1 : 0;
    case 'on_time':
      return action.kind === 'submission' && action.onTime ? 1 : 0;
    case 'practice':
      return action.kind === 'practice' ? 1 : 0;
    case 'xp':
      return action.kind === 'xp' ? (action.amount ?? 0) : 0;
    default:
      return 0;
  }
}

export interface WeeklyQuestDef {
  key: 'lessons' | 'on_time' | 'xp';
  metric: QuestMetric;
  goal: number;
  rewardXp: number;
}

/** The personal quests generated each Monday from what the student actually has ahead of them. */
export function weeklyQuests(context: {
  lessonsAvailable: number;
  assignmentsDueThisWeek: number;
}): WeeklyQuestDef[] {
  const out: WeeklyQuestDef[] = [];
  if (context.lessonsAvailable > 0)
    out.push({
      key: 'lessons',
      metric: 'lessons',
      goal: Math.min(3, context.lessonsAvailable),
      rewardXp: 30,
    });
  if (context.assignmentsDueThisWeek > 0)
    out.push({
      key: 'on_time',
      metric: 'on_time',
      goal: Math.min(2, context.assignmentsDueThisWeek),
      rewardXp: 30,
    });
  out.push({ key: 'xp', metric: 'xp', goal: 100, rewardXp: 20 });
  return out;
}

/** Monday 00:00 to next Monday 00:00 (UTC dates), for the week containing `now`. */
export function weekWindow(now: Date): { startsAt: Date; endsAt: Date } {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const day = start.getUTCDay();
  start.setUTCDate(start.getUTCDate() - ((day + 6) % 7));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { startsAt: start, endsAt: end };
}
