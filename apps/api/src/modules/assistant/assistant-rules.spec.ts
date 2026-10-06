import {
  composeEmail,
  feedbackFromSuggestion,
  insightDataLines,
  rubricBlock,
  scaledScore,
  shouldRevokeTeacherRow,
  summariseSuggestion,
  topTopics,
  validSubstituteWindow,
} from './assistant-rules';

describe('assistant rules', () => {
  it('turns a rubric into one line per criterion, or one overall criterion', () => {
    expect(rubricBlock([], 10)).toBe(
      'overall | 10 | Overall quality: completeness, accuracy and clarity',
    );
    expect(
      rubricBlock(
        [
          {
            id: 'thesis',
            title: 'Thesis',
            maxPoints: 5,
            description: 'A clear claim',
          },
          { id: 'evidence', title: 'Evidence', maxPoints: 5 },
        ],
        10,
      ),
    ).toBe('thesis | 5 | Thesis: A clear claim\nevidence | 5 | Evidence');
  });

  it('scales rubric totals to assignment points', () => {
    expect(scaledScore(8, 10, 10)).toBe(8);
    expect(scaledScore(6, 10, 25)).toBe(15);
    expect(scaledScore(2, 3, 10)).toBe(6.67);
    expect(scaledScore(5, 0, 10)).toBe(0);
  });

  it('summarises a suggestion and insists on review when unsure or flagged', () => {
    const sure = summariseSuggestion({
      criteria: [
        { criterionId: 'a', score: 4, maxPoints: 5, confidence: 0.9 },
        { criterionId: 'b', score: 5, maxPoints: 5, confidence: 0.8 },
      ],
      overall: { score: 9, maxPoints: 10 },
      needsHumanReview: false,
      flag: null,
    });
    expect(sure).toEqual({
      score: 9,
      maxPoints: 10,
      confidence: 0.8,
      needsHumanReview: false,
      flag: null,
    });
    expect(
      summariseSuggestion({
        criteria: [
          { criterionId: 'a', score: 4, maxPoints: 5, confidence: 0.5 },
        ],
        overall: { score: 4, maxPoints: 5 },
        needsHumanReview: false,
      }).needsHumanReview,
    ).toBe(true);
    expect(
      summariseSuggestion({
        criteria: [
          { criterionId: 'a', score: 4, maxPoints: 5, confidence: 0.95 },
        ],
        needsHumanReview: false,
        flag: 'mentions self-harm',
      }),
    ).toMatchObject({ needsHumanReview: true, flag: 'mentions self-harm' });
    expect(summariseSuggestion({})).toMatchObject({
      score: 0,
      confidence: 0,
      needsHumanReview: true,
    });
    expect(
      feedbackFromSuggestion({
        summary: 'Clear claim.',
        criteria: [{ feedback: 'Add evidence.' }, { feedback: '' }],
      }),
    ).toBe('Clear claim.\nAdd evidence.');
  });

  it('composes the family message without blank-line pile-ups', () => {
    const text = composeEmail(
      {
        subject: "Ava's week",
        greeting: 'Dear family,',
        body: ['Ava did well.', 'Keep reading.'],
        closing: '',
        signature: 'Ms. Lee',
      },
      'fallback',
    );
    expect(text).toBe(
      "Ava's week\n\nDear family,\n\nAva did well.\n\nKeep reading.\n\nMs. Lee",
    );
    expect(
      composeEmail({ body: ['Hi.'] }, 'Progress').startsWith('Progress\n\n'),
    ).toBe(true);
  });

  it('writes every insight number into the DATA block and ranks tutor topics', () => {
    const lines = insightDataLines({
      students: 18,
      tutor: {
        studentsWhoUsedIt: 12,
        conversationsThisWeek: 30,
        conversationsLastWeek: 21,
        refusals: 1,
        topTopics: [{ topic: 'Fractions', conversations: 9 }],
      },
      work: {
        assignmentsDueLast14Days: 3,
        missingItems: 6,
        submissionsThisWeek: 40,
        averageScoreRecent: 84,
        lowScoringAssignments: [{ title: 'Quiz 2', average: 61 }],
      },
      attendance: { recordsThisWeek: 72, presentRate: 94 },
      classAverage: 88,
      lessonsCompletedThisWeek: 25,
    });
    for (const n of [
      '18',
      '12',
      '30',
      '21',
      '1 refused',
      'Fractions (9',
      '6 items',
      '3 assignments',
      '40',
      '84%',
      'Quiz 2 average 61%',
      '94% present',
      '72 records',
      '88%',
      '25',
    ])
      expect(lines.join('\n')).toContain(n);
    expect(
      insightDataLines({
        students: 0,
        tutor: {
          studentsWhoUsedIt: 0,
          conversationsThisWeek: 0,
          conversationsLastWeek: 0,
          refusals: 0,
          topTopics: [],
        },
        work: {
          assignmentsDueLast14Days: 0,
          missingItems: 0,
          submissionsThisWeek: 0,
          averageScoreRecent: null,
          lowScoringAssignments: [],
        },
        attendance: { recordsThisWeek: 0, presentRate: null },
        classAverage: null,
        lessonsCompletedThisWeek: 0,
      }).join('\n'),
    ).toContain('none graded');
    expect(
      topTopics([
        { topic: 'b' },
        { topic: 'a' },
        { topic: 'b' },
        { topic: 'c' },
        { topic: 'd' },
      ]),
    ).toEqual([
      { topic: 'b', conversations: 2 },
      { topic: 'a', conversations: 1 },
      { topic: 'c', conversations: 1 },
    ]);
  });

  it('removes only the co-teacher rows a substitute grant created', () => {
    const grant = new Date('2026-10-01T00:00:00Z');
    const after = {
      isPrimary: false,
      assignedAt: new Date('2026-10-02T00:00:00Z'),
    };
    const before = {
      isPrimary: false,
      assignedAt: new Date('2026-09-01T00:00:00Z'),
    };
    expect(
      shouldRevokeTeacherRow({
        stillActiveAccess: 0,
        row: after,
        earliestGrantAt: grant,
      }),
    ).toBe(true);
    expect(
      shouldRevokeTeacherRow({
        stillActiveAccess: 1,
        row: after,
        earliestGrantAt: grant,
      }),
    ).toBe(false);
    expect(
      shouldRevokeTeacherRow({
        stillActiveAccess: 0,
        row: before,
        earliestGrantAt: grant,
      }),
    ).toBe(false);
    expect(
      shouldRevokeTeacherRow({
        stillActiveAccess: 0,
        row: { ...after, isPrimary: true },
        earliestGrantAt: grant,
      }),
    ).toBe(false);
    expect(
      shouldRevokeTeacherRow({
        stillActiveAccess: 0,
        row: null,
        earliestGrantAt: grant,
      }),
    ).toBe(false);
    const now = new Date('2026-10-06T12:00:00Z');
    expect(
      validSubstituteWindow(
        new Date('2026-10-06T08:00:00Z'),
        new Date('2026-10-07T08:00:00Z'),
        now,
      ),
    ).toBe(true);
    expect(
      validSubstituteWindow(
        new Date('2026-10-07T08:00:00Z'),
        new Date('2026-10-07T07:00:00Z'),
        now,
      ),
    ).toBe(false);
    expect(
      validSubstituteWindow(
        new Date('2026-10-01T08:00:00Z'),
        new Date('2026-10-02T08:00:00Z'),
        now,
      ),
    ).toBe(false);
  });
});
