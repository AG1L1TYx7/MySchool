import {
  canEditContent,
  canModerate,
  canPost,
  canSeeContent,
  canSeeGroup,
  classMembership,
  joinOutcome,
  muteUntil,
  postRecipients,
  rankTopics,
  resolutionEffect,
  screenText,
  statusAfterAction,
  type GroupLike,
  type MemberLike,
  type Viewer,
} from './community-rules';

const now = new Date('2026-10-09T12:00:00Z');
const org = 'org-1';
const group = (over: Partial<GroupLike> = {}): GroupLike => ({
  organizationId: org,
  kind: 'club',
  visibility: 'members',
  joinPolicy: 'open',
  studentsCanPost: true,
  status: 'active',
  ...over,
});
const viewer = (role: Viewer['role'], over: Partial<Viewer> = {}): Viewer => ({
  id: `${role.toLowerCase()}-1`,
  role,
  organizationId: org,
  reachesOrganization: false,
  ...over,
});
const member = (over: Partial<MemberLike> = {}): MemberLike => ({
  role: 'member',
  status: 'active',
  mutedUntil: null,
  ...over,
});

describe('community rules', () => {
  describe('seeing a group', () => {
    it('members-only groups are hidden from non-members at the same school', () => {
      expect(canSeeGroup(group(), viewer('STUDENT'), null)).toBe(false);
      expect(canSeeGroup(group(), viewer('STUDENT'), member())).toBe(true);
    });
    it('school-visible groups are readable by anyone at the school, never by another school', () => {
      expect(
        canSeeGroup(group({ visibility: 'school' }), viewer('PARENT'), null),
      ).toBe(true);
      expect(
        canSeeGroup(
          group({ visibility: 'school' }),
          viewer('TEACHER', { organizationId: 'org-2' }),
          null,
        ),
      ).toBe(false);
    });
    it('the principal and counselor see every group of their school; a superintendent only within reach', () => {
      expect(canSeeGroup(group(), viewer('PRINCIPAL'), null)).toBe(true);
      expect(canSeeGroup(group(), viewer('COUNSELOR'), null)).toBe(true);
      expect(
        canSeeGroup(
          group(),
          viewer('SUPERINTENDENT', {
            organizationId: null,
            reachesOrganization: true,
          }),
          null,
        ),
      ).toBe(true);
      expect(
        canSeeGroup(
          group(),
          viewer('SUPERINTENDENT', {
            organizationId: null,
            reachesOrganization: false,
          }),
          null,
        ),
      ).toBe(false);
    });
    it('archived groups stay readable for members and moderators only', () => {
      const g = group({ status: 'archived', visibility: 'school' });
      expect(canSeeGroup(g, viewer('STUDENT'), null)).toBe(false);
      expect(canSeeGroup(g, viewer('STUDENT'), member())).toBe(true);
    });
  });

  describe('moderating', () => {
    it('is for group moderators, administrators and counselors, not plain members or teachers who are not in the group', () => {
      expect(
        canModerate(group(), viewer('STUDENT'), member({ role: 'moderator' })),
      ).toBe(true);
      expect(canModerate(group(), viewer('TEACHER'), member())).toBe(false);
      expect(canModerate(group(), viewer('TEACHER'), null)).toBe(false);
      expect(canModerate(group(), viewer('PRINCIPAL'), null)).toBe(true);
      expect(
        canModerate(
          group(),
          viewer('PRINCIPAL', { organizationId: 'org-2' }),
          null,
        ),
      ).toBe(false);
    });
  });

  describe('joining', () => {
    it('open groups admit at once, approval groups queue, invite-only groups refuse', () => {
      expect(joinOutcome(group(), viewer('STUDENT'), null)).toBe('active');
      expect(
        joinOutcome(group({ joinPolicy: 'approval' }), viewer('STUDENT'), null),
      ).toBe('pending');
      expect(
        joinOutcome(group({ joinPolicy: 'invite' }), viewer('STUDENT'), null),
      ).toBe('not_allowed');
    });
    it('class groups, parents, other schools and archived groups cannot be joined; members are told so', () => {
      expect(
        joinOutcome(group({ kind: 'class' }), viewer('STUDENT'), null),
      ).toBe('not_allowed');
      expect(joinOutcome(group(), viewer('PARENT'), null)).toBe('not_allowed');
      expect(
        joinOutcome(
          group(),
          viewer('STUDENT', { organizationId: 'org-2' }),
          null,
        ),
      ).toBe('not_allowed');
      expect(
        joinOutcome(group({ status: 'archived' }), viewer('STUDENT'), null),
      ).toBe('not_allowed');
      expect(joinOutcome(group(), viewer('STUDENT'), member())).toBe('already');
      expect(
        joinOutcome(group(), viewer('STUDENT'), member({ status: 'removed' })),
      ).toBe('active');
    });
  });

  describe('posting', () => {
    it('active members post; outsiders, parents and muted members do not', () => {
      expect(canPost(group(), viewer('STUDENT'), member(), now)).toEqual({
        ok: true,
      });
      expect(canPost(group(), viewer('STUDENT'), null, now).reason).toBe(
        'not_member',
      );
      expect(canPost(group(), viewer('PARENT'), member(), now).reason).toBe(
        'parent',
      );
      expect(
        canPost(
          group(),
          viewer('STUDENT'),
          member({ mutedUntil: new Date(now.getTime() + 1000) }),
          now,
        ).reason,
      ).toBe('muted');
      expect(
        canPost(
          group(),
          viewer('STUDENT'),
          member({ mutedUntil: new Date(now.getTime() - 1000) }),
          now,
        ).ok,
      ).toBe(true);
    });
    it('read-only groups stop students but not teachers who are members', () => {
      const g = group({ studentsCanPost: false });
      expect(canPost(g, viewer('STUDENT'), member(), now).reason).toBe(
        'students_read_only',
      );
      expect(canPost(g, viewer('TEACHER'), member(), now).ok).toBe(true);
    });
    it('locked topics and archived groups take posts from moderators only', () => {
      expect(
        canPost(group(), viewer('STUDENT'), member(), now, { locked: true })
          .reason,
      ).toBe('locked');
      expect(
        canPost(
          group(),
          viewer('STUDENT'),
          member({ role: 'moderator' }),
          now,
          { locked: true },
        ).ok,
      ).toBe(true);
      expect(
        canPost(group({ status: 'archived' }), viewer('STUDENT'), member(), now)
          .reason,
      ).toBe('archived');
      expect(
        canPost(group({ status: 'archived' }), viewer('PRINCIPAL'), null, now)
          .ok,
      ).toBe(true);
    });
  });

  describe('editing and seeing content', () => {
    const post = (
      over: Partial<{
        authorId: string | null;
        createdAt: Date;
        status: string;
      }> = {},
    ) => ({
      authorId: 'student-1',
      createdAt: new Date(now.getTime() - 10 * 60_000),
      status: 'visible',
      ...over,
    });
    it('authors edit for thirty minutes, moderators any time, nobody edits removed content', () => {
      expect(canEditContent(post(), 'student-1', false, now)).toBe(true);
      expect(
        canEditContent(
          post({ createdAt: new Date(now.getTime() - 31 * 60_000) }),
          'student-1',
          false,
          now,
        ),
      ).toBe(false);
      expect(
        canEditContent(
          post({ createdAt: new Date(now.getTime() - 31 * 60_000) }),
          'teacher-1',
          true,
          now,
        ),
      ).toBe(true);
      expect(canEditContent(post(), 'student-2', false, now)).toBe(false);
      expect(
        canEditContent(post({ status: 'removed' }), 'teacher-1', true, now),
      ).toBe(false);
    });
    it('held and hidden content shows to its author and moderators; removed content to moderators only', () => {
      expect(canSeeContent(post({ status: 'held' }), 'student-1', false)).toBe(
        true,
      );
      expect(canSeeContent(post({ status: 'held' }), 'student-2', false)).toBe(
        false,
      );
      expect(canSeeContent(post({ status: 'hidden' }), 'student-2', true)).toBe(
        true,
      );
      expect(
        canSeeContent(post({ status: 'removed' }), 'student-1', false),
      ).toBe(false);
      expect(
        canSeeContent(post({ status: 'removed' }), 'teacher-1', true),
      ).toBe(true);
    });
  });

  describe('screening a student post', () => {
    it('holds phone numbers, emails, street addresses and social handles', () => {
      expect(screenText('text me at 555-123-4567', 'STUDENT')).toEqual({
        ok: false,
        reason: 'personal_info',
      });
      expect(screenText('email emma@example.com', 'STUDENT').reason).toBe(
        'personal_info',
      );
      expect(screenText('I live at 12 Maple Street', 'STUDENT').reason).toBe(
        'personal_info',
      );
      expect(screenText('add me on snap: emma_j7', 'STUDENT').reason).toBe(
        'personal_info',
      );
      expect(screenText('find me @emma.j', 'STUDENT').reason).toBe(
        'personal_info',
      );
    });
    it('holds unkind phrases and outside links, and passes ordinary words', () => {
      expect(screenText('Nobody likes you, go away', 'STUDENT').reason).toBe(
        'unkind',
      );
      expect(screenText('What an idiot', 'STUDENT').reason).toBe('unkind');
      expect(screenText('see https://example.com', 'STUDENT').reason).toBe(
        'link',
      );
      expect(
        screenText(
          'I think the character changes after chapter 3 because of her sister.',
          'STUDENT',
        ),
      ).toEqual({ ok: true });
      expect(screenText('My idiom collection grew', 'STUDENT').ok).toBe(true);
      expect(
        screenText('Order number 1759987654321 arrived', 'STUDENT').ok,
      ).toBe(true);
      expect(screenText('(555) 123-4567', 'STUDENT').ok).toBe(false);
    });
    it('trusts staff', () => {
      expect(
        screenText('Call the office at 555-123-4567 with questions', 'TEACHER'),
      ).toEqual({ ok: true });
    });
  });

  it('ranks pinned topics first and then by the latest activity', () => {
    const t = (
      id: string,
      pinned: boolean,
      last: string | null,
      created: string,
    ) => ({
      id,
      pinned,
      lastPostAt: last ? new Date(last) : null,
      createdAt: new Date(created),
    });
    const ranked = rankTopics([
      t('old', false, null, '2026-10-01'),
      t('busy', false, '2026-10-08', '2026-10-02'),
      t('pinned', true, null, '2026-09-01'),
      t('new', false, null, '2026-10-07'),
    ]);
    expect(ranked.map((x) => x.id)).toEqual(['pinned', 'busy', 'new', 'old']);
  });

  it('maps moderation actions and report resolutions to states', () => {
    expect(statusAfterAction('approve')).toBe('visible');
    expect(statusAfterAction('restore')).toBe('visible');
    expect(statusAfterAction('hide')).toBe('hidden');
    expect(statusAfterAction('remove')).toBe('removed');
    expect(resolutionEffect('dismiss')).toEqual({
      status: null,
      notifyAuthor: false,
    });
    expect(resolutionEffect('warn')).toEqual({
      status: null,
      notifyAuthor: true,
    });
    expect(resolutionEffect('hide')).toEqual({
      status: 'hidden',
      notifyAuthor: true,
    });
    expect(resolutionEffect('remove')).toEqual({
      status: 'removed',
      notifyAuthor: true,
    });
  });

  it('mutes for whole days within limits and tells subscribers except the author', () => {
    expect(muteUntil(0.5, now).getTime() - now.getTime()).toBe(86_400_000);
    expect(muteUntil(90, now).getTime() - now.getTime()).toBe(30 * 86_400_000);
    expect(muteUntil(3, now).getTime() - now.getTime()).toBe(3 * 86_400_000);
    expect(postRecipients(['a', 'b', 'a', 'me'], 'me')).toEqual(['a', 'b']);
  });

  it('builds the class membership from enrolments and teachers, teachers as moderators', () => {
    expect(classMembership(['s1', null, 's2', 't1'], ['t1'])).toEqual([
      { userId: 's1', role: 'member' },
      { userId: 's2', role: 'member' },
      { userId: 't1', role: 'moderator' },
    ]);
  });
});
