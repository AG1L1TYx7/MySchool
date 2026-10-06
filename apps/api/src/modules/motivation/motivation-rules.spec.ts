import {
  advanceStreak,
  levelFor,
  newlyEarnedBadges,
  previousSchoolDay,
  questIncrement,
  streakAlive,
  titleFor,
  weeklyQuests,
  weekWindow,
  xpForLevel,
  type BadgeStats,
  type StreakState,
} from './motivation-rules';

const stats = (over: Partial<BadgeStats> = {}): BadgeStats => ({
  lessonsCompleted: 0,
  modulesCompleted: 0,
  onTimeSubmissions: 0,
  improvedInARow: 0,
  perfectScores: 0,
  streakDays: 0,
  longestStreak: 0,
  level: 1,
  ...over,
});

describe('motivation rules', () => {
  it('levels grow geometrically and never go down', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(100);
    expect(xpForLevel(3)).toBe(250);
    expect(xpForLevel(4)).toBe(475);
    expect(levelFor(0)).toBe(1);
    expect(levelFor(99)).toBe(1);
    expect(levelFor(100)).toBe(2);
    expect(levelFor(474)).toBe(3);
    expect(levelFor(475)).toBe(4);
    for (let n = 2; n < 30; n++)
      expect(xpForLevel(n)).toBeGreaterThan(xpForLevel(n - 1));
    expect(titleFor(1)).toBe('newcomer');
    expect(titleFor(3)).toBe('explorer');
    expect(titleFor(6)).toBe('scholar');
    expect(titleFor(10)).toBe('achiever');
    expect(titleFor(15)).toBe('champion');
    expect(titleFor(20)).toBe('legend');
  });

  it('skips weekends when finding the previous school day', () => {
    expect(previousSchoolDay('2026-10-05')).toBe('2026-10-02'); // Monday -> Friday
    expect(previousSchoolDay('2026-10-07')).toBe('2026-10-06');
  });

  it('extends, freezes and resets streaks', () => {
    const fresh: StreakState = {
      streakDays: 0,
      longestStreak: 0,
      lastActionOn: null,
      freezeTokens: 0,
      freezesUsed: 0,
    };
    const day1 = advanceStreak(fresh, '2026-10-05');
    expect(day1.streakDays).toBe(1);
    expect(day1.extended).toBe(false);
    expect(advanceStreak(day1, '2026-10-05').streakDays).toBe(1); // same day: unchanged
    const day2 = advanceStreak(day1, '2026-10-06');
    expect(day2.streakDays).toBe(2);
    expect(day2.extended).toBe(true);
    // Friday to Monday keeps the streak.
    const fri = advanceStreak(day2, '2026-10-09');
    const mon = advanceStreak({ ...fri, streakDays: 4 }, '2026-10-12');
    expect(mon.streakDays).toBe(5);
    expect(mon.earnedFreeze).toBe(true);
    expect(mon.freezeTokens).toBe(1);
    // One missed school day with a token: the token covers it.
    const wed = advanceStreak(mon, '2026-10-14');
    expect(wed.usedFreeze).toBe(true);
    expect(wed.streakDays).toBe(6);
    expect(wed.freezeTokens).toBe(0);
    // Two missed days with no token: reset.
    const later = advanceStreak(wed, '2026-10-19');
    expect(later.reset).toBe(true);
    expect(later.streakDays).toBe(1);
    expect(later.longestStreak).toBe(6);
    expect(streakAlive(mon, '2026-10-13')).toBe(true);
    expect(streakAlive(mon, '2026-10-14')).toBe(true); // token can cover
    expect(streakAlive({ ...mon, freezeTokens: 0 }, '2026-10-14')).toBe(false);
  });

  it('awards badges once from stats and leaves teacher badges alone', () => {
    expect(
      newlyEarnedBadges(stats({ lessonsCompleted: 1 }), new Set()),
    ).toEqual(['first-steps']);
    expect(
      newlyEarnedBadges(
        stats({ lessonsCompleted: 1 }),
        new Set(['first-steps']),
      ),
    ).toEqual([]);
    const many = newlyEarnedBadges(
      stats({
        lessonsCompleted: 12,
        onTimeSubmissions: 5,
        improvedInARow: 2,
        longestStreak: 7,
        level: 5,
      }),
      new Set(),
    );
    expect(many).toEqual([
      'first-steps',
      'bookworm',
      'on-time-5',
      'growth-2',
      'streak-7',
      'level-5',
    ]);
    expect(many).not.toContain('kindness');
  });

  it('moves quests by metric and builds weekly quests from what is ahead', () => {
    expect(questIncrement('lessons', { kind: 'lesson' })).toBe(1);
    expect(
      questIncrement('on_time', { kind: 'submission', onTime: false }),
    ).toBe(0);
    expect(
      questIncrement('on_time', { kind: 'submission', onTime: true }),
    ).toBe(1);
    expect(questIncrement('xp', { kind: 'xp', amount: 25 })).toBe(25);
    expect(
      weeklyQuests({ lessonsAvailable: 0, assignmentsDueThisWeek: 0 }).map(
        (q) => q.key,
      ),
    ).toEqual(['xp']);
    const full = weeklyQuests({
      lessonsAvailable: 8,
      assignmentsDueThisWeek: 1,
    });
    expect(full.map((q) => [q.key, q.goal])).toEqual([
      ['lessons', 3],
      ['on_time', 1],
      ['xp', 100],
    ]);
    const w = weekWindow(new Date('2026-10-08T15:00:00Z')); // Thursday
    expect(w.startsAt.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(w.endsAt.toISOString()).toBe('2026-10-12T00:00:00.000Z');
  });
});
