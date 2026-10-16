import { classroomSnapshot, gradesToPush } from './google-classroom';

describe('Google Classroom mapping (slice 30)', () => {
  it('turns active courses with their teachers and students into a roster snapshot', () => {
    const snap = classroomSnapshot(
      [
        {
          id: 'c1',
          name: 'Algebra 1',
          section: 'Period 2',
          courseState: 'ACTIVE',
        },
        { id: 'c2', name: 'Old course', courseState: 'ARCHIVED' },
      ],
      new Map([
        [
          'c1',
          {
            teachers: [
              {
                userId: 't1',
                profile: {
                  emailAddress: 'T@School.test',
                  name: { givenName: 'Taylor', familyName: 'Brooks' },
                },
              },
            ],
            students: [
              {
                userId: 's1',
                profile: {
                  emailAddress: 's1@school.test',
                  name: { fullName: 'Ana Roster' },
                },
              },
              { userId: 't1', profile: { emailAddress: 't@school.test' } },
              { userId: '' },
            ],
          },
        ],
      ]),
      { externalId: 'classroom', name: 'Demo School' },
    );
    expect(snap.schools).toEqual([
      { externalId: 'classroom', name: 'Demo School' },
    ]);
    expect(
      snap.classes.map((c) => [c.externalId, c.title, c.classCode]),
    ).toEqual([['c1', 'Algebra 1', 'Period 2']]);
    expect(
      snap.users.map((u) => [
        u.externalId,
        u.role,
        u.email,
        u.firstName,
        u.lastName,
      ]),
    ).toEqual([
      ['t1', 'teacher', 't@school.test', 'Taylor', 'Brooks'],
      ['s1', 'student', 's1@school.test', 'Ana', 'Roster'],
    ]);
    expect(
      snap.enrollments.map((e) => [e.userExternalId, e.role, e.primary]),
    ).toEqual([
      ['t1', 'teacher', true],
      ['s1', 'student', false],
      ['t1', 'student', false],
    ]);
  });

  it('pushes only grades whose student has a Classroom submission', () => {
    expect(
      gradesToPush(
        [
          { studentId: 'st1', score: 9, externalUserId: 'g1' },
          { studentId: 'st2', score: 7, externalUserId: null },
          { studentId: 'st3', score: 5, externalUserId: 'g3' },
        ],
        [
          { id: 'sub1', userId: 'g1' },
          { id: 'sub2', userId: 'g2' },
        ],
      ),
    ).toEqual([{ studentId: 'st1', submissionId: 'sub1', score: 9 }]);
  });
});
