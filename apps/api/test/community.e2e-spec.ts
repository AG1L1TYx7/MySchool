import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AI_STUB_PORT, AI_STUB_TOKEN } from './ai-env';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { startAiStub } from './ai-stub';

interface Problem {
  code: string;
}
interface Group {
  id: string;
  kind: string;
  status: string;
  membership: { role: string; status: string } | null;
  canSee: boolean;
  canPost: boolean;
  canModerate: boolean;
  joinOutcome: string;
  joinPolicy: string;
  postBlockedReason: string | null;
}
interface Topic {
  id: string;
  status: string;
  locked: boolean;
  pinned: boolean;
  postCount: number;
  holdReason: string | null;
  posts: Post[];
  subscribed: boolean;
  canReply: boolean;
}
interface Post {
  id: string;
  status: string;
  holdReason: string | null;
  reactions: Record<string, number>;
  myReaction: string | null;
}
interface Queue {
  held: Array<{ type: string; id: string }>;
  reports: Array<{ id: string; targetId: string }>;
  summary: { total: number };
}

const PASSWORD = 'SmartSchool!Demo2026';

/**
 * Community (slice 25): clubs and class discussions, posting rules, the safety check that holds a
 * student's words for a teacher, the moderation queue, reports with audit, pins, locks, mutes,
 * reactions and subscriptions.
 */
describe('Community (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let stub: Awaited<ReturnType<typeof startAiStub>>;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const stamp = Date.now();
  let classId = '';
  let clubId = '';
  let classGroupId = '';
  let topicId = '';
  let teacherPostId = '';
  let heldPostId = '';
  let reportId = '';

  const login = async (role: string) => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: `${role}@smartschool.local`, password: PASSWORD })
      .expect(200);
    tokens[role] = (res.body as { accessToken: string }).accessToken;
    const user = await prisma.user.findFirstOrThrow({
      where: { email: `${role}@smartschool.local` },
      select: { id: true },
    });
    ids[role] = user.id;
  };
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });

  beforeAll(async () => {
    stub = await startAiStub(AI_STUB_TOKEN, AI_STUB_PORT);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configureApp(
      moduleRef.createNestApplication<NestExpressApplication>({
        bodyParser: false,
      }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    for (const r of ['teacher', 'student', 'parent', 'principal', 'counselor'])
      await login(r);
    const enrolment = await prisma.classEnrollment.findFirstOrThrow({
      where: {
        status: 'ENROLLED',
        student: { userId: ids.student },
        class: { teachers: { some: { teacherId: ids.teacher } } },
      },
      select: { classId: true },
    });
    classId = enrolment.classId;
    // Earlier runs leave groups behind; start clean so the lazy class group and the queue are predictable.
    await prisma.communityGroup.deleteMany({
      where: { OR: [{ classId }, { name: { startsWith: 'Chess club' } }] },
    });
    await prisma.communityReport.deleteMany({
      where: { reporterId: { in: [ids.parent, ids.student] } },
    });
  });

  afterAll(async () => {
    await app?.close();
    stub.server.close();
  });

  it('a teacher creates a club; a student finds and joins it; a parent cannot join', async () => {
    const created = await request(server)
      .post('/api/v1/community/groups')
      .set(as('teacher'))
      .send({
        name: `Chess club ${stamp}`,
        description: 'Wednesdays after school.',
        kind: 'club',
        visibility: 'members',
        joinPolicy: 'open',
      })
      .expect(201);
    const club = created.body as Group;
    clubId = club.id;
    expect(club.membership).toEqual(
      expect.objectContaining({ role: 'moderator', status: 'active' }),
    );
    expect(club.canModerate).toBe(true);

    const listed = await request(server)
      .get('/api/v1/community/groups')
      .set(as('student'))
      .expect(200);
    const found = (listed.body as { data: Group[] }).data.find(
      (g) => g.id === clubId,
    );
    expect(found).toBeDefined();
    expect(found?.canSee).toBe(false);
    expect(found?.joinOutcome).toBe('active');

    const joined = await request(server)
      .post(`/api/v1/community/groups/${clubId}/join`)
      .set(as('student'))
      .expect(201);
    expect((joined.body as Group).membership?.status).toBe('active');
    expect((joined.body as Group).canPost).toBe(true);

    // Parents never hold community.post, so the feature gate answers before the join rule does.
    await request(server)
      .post(`/api/v1/community/groups/${clubId}/join`)
      .set(as('parent'))
      .expect(403);
    const invite = await request(server)
      .patch(`/api/v1/community/groups/${clubId}`)
      .set(as('teacher'))
      .send({ joinPolicy: 'invite' })
      .expect(200);
    expect((invite.body as Group).joinPolicy).toBe('invite');
    const denied = await request(server)
      .post(`/api/v1/community/groups/${clubId}/join`)
      .set(as('counselor'))
      .expect(403);
    expect((denied.body as Problem).code).toBe('community.join_not_allowed');
    await request(server)
      .patch(`/api/v1/community/groups/${clubId}`)
      .set(as('teacher'))
      .send({ joinPolicy: 'open' })
      .expect(200);

    await request(server)
      .post('/api/v1/community/groups')
      .set(as('student'))
      .send({ name: 'Not allowed' })
      .expect(403);
  });

  it('the class discussion appears on first open with the roster as members and teachers as moderators', async () => {
    const mine = await request(server)
      .get(`/api/v1/community/classes/${classId}`)
      .set(as('student'))
      .expect(200);
    const group = mine.body as Group;
    classGroupId = group.id;
    expect(group.kind).toBe('class');
    expect(group.membership?.role).toBe('member');
    expect(group.canPost).toBe(true);

    const teacherView = await request(server)
      .get(`/api/v1/community/classes/${classId}`)
      .set(as('teacher'))
      .expect(200);
    expect((teacherView.body as Group).id).toBe(classGroupId);
    expect((teacherView.body as Group).canModerate).toBe(true);

    const parentView = await request(server)
      .get(`/api/v1/community/classes/${classId}`)
      .set(as('parent'))
      .expect(200);
    expect((parentView.body as Group).canSee).toBe(true);
    expect((parentView.body as Group).canPost).toBe(false);
    expect((parentView.body as Group).postBlockedReason).toContain('Family');

    const counselorView = await request(server)
      .get(`/api/v1/community/groups/${classGroupId}`)
      .set(as('counselor'))
      .expect(200);
    expect((counselorView.body as Group).canModerate).toBe(true);

    await request(server)
      .delete(`/api/v1/community/groups/${classGroupId}/join`)
      .set(as('student'))
      .expect(400);
  });

  it('clean words show at once; a phone number holds a student reply for a teacher; parents read only', async () => {
    const topic = await request(server)
      .post(`/api/v1/community/groups/${classGroupId}/topics`)
      .set(as('student'))
      .send({
        title: `Chapter 3 question ${stamp}`,
        body: 'Why does the character change her mind after the storm?',
      })
      .expect(201);
    topicId = (topic.body as Topic).id;
    expect((topic.body as Topic).status).toBe('visible');
    expect((topic.body as Topic).subscribed).toBe(true);

    const reply = await request(server)
      .post(`/api/v1/community/topics/${topicId}/posts`)
      .set(as('teacher'))
      .send({
        body: 'Good question. Look at what she says to her sister on page 41.',
      })
      .expect(201);
    teacherPostId = (reply.body as Post).id;
    expect((reply.body as Post).status).toBe('visible');

    const held = await request(server)
      .post(`/api/v1/community/topics/${topicId}/posts`)
      .set(as('student'))
      .send({
        body: 'Thanks! Text me at 555-123-4567 if you want to study together.',
      })
      .expect(201);
    heldPostId = (held.body as Post).id;
    expect((held.body as Post).status).toBe('held');
    expect((held.body as Post).holdReason).toContain('teacher');

    // Parents do not hold community.post: the feature gate answers first; the page explains with canReply.
    await request(server)
      .post(`/api/v1/community/topics/${topicId}/posts`)
      .set(as('parent'))
      .send({ body: 'Hello from home' })
      .expect(403);

    const asParent = await request(server)
      .get(`/api/v1/community/topics/${topicId}`)
      .set(as('parent'))
      .expect(200);
    expect((asParent.body as Topic).posts.map((p) => p.id)).toEqual([
      teacherPostId,
    ]);
    expect((asParent.body as Topic).canReply).toBe(false);

    const asStudent = await request(server)
      .get(`/api/v1/community/topics/${topicId}`)
      .set(as('student'))
      .expect(200);
    expect((asStudent.body as Topic).posts.map((p) => p.id)).toEqual([
      teacherPostId,
      heldPostId,
    ]);
    expect((asStudent.body as Topic).postCount).toBe(1);
  });

  it('the teacher sees the held reply in the queue, approves it, and the decision is audited and told to the author', async () => {
    const queue = await request(server)
      .get('/api/v1/community/moderation')
      .set(as('teacher'))
      .expect(200);
    expect((queue.body as Queue).held.map((h) => h.id)).toContain(heldPostId);

    await request(server)
      .get('/api/v1/community/moderation')
      .set(as('student'))
      .expect(403);

    await request(server)
      .post(`/api/v1/community/posts/${heldPostId}/moderate`)
      .set(as('teacher'))
      .send({ action: 'approve' })
      .expect(201);

    const after = await request(server)
      .get(`/api/v1/community/topics/${topicId}`)
      .set(as('parent'))
      .expect(200);
    expect((after.body as Topic).posts.map((p) => p.id)).toEqual([
      teacherPostId,
      heldPostId,
    ]);
    expect((after.body as Topic).postCount).toBe(2);

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: 'community.post.moderate',
        entityId: heldPostId,
        userId: ids.teacher,
      },
    });
    expect(audit).not.toBeNull();
    const told = await prisma.notification.findFirst({
      where: {
        recipientId: ids.student,
        category: 'COMMUNITY',
        entityId: heldPostId,
      },
    });
    expect(told?.title).toContain('now visible');
  });

  it('a parent reports the topic; the principal closes it with a reminder; the author and reporter hear about it', async () => {
    const report = await request(server)
      .post('/api/v1/community/reports')
      .set(as('parent'))
      .send({
        targetType: 'topic',
        targetId: topicId,
        reason: 'other',
        details: 'Please check the tone.',
      })
      .expect(201);
    reportId = (report.body as { id: string }).id;

    const queue = await request(server)
      .get('/api/v1/community/moderation')
      .set(as('principal'))
      .expect(200);
    expect((queue.body as Queue).reports.map((r) => r.id)).toContain(reportId);

    await request(server)
      .post(`/api/v1/community/reports/${reportId}/resolve`)
      .set(as('principal'))
      .send({
        resolution: 'warn',
        note: 'All good, just keep it about the book.',
      })
      .expect(201);

    const closed = await prisma.communityReport.findUniqueOrThrow({
      where: { id: reportId },
    });
    expect(closed.status).toBe('closed');
    expect(closed.resolvedById).toBe(ids.principal);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'community.report.resolve', entityId: reportId },
    });
    expect(audit).not.toBeNull();
    const warned = await prisma.notification.findFirst({
      where: {
        recipientId: ids.student,
        category: 'COMMUNITY',
        entityId: reportId,
      },
    });
    expect(warned?.title).toContain('reminder');
    const thanked = await prisma.notification.findFirst({
      where: {
        recipientId: ids.parent,
        category: 'COMMUNITY',
        entityId: reportId,
      },
    });
    expect(thanked?.title).toContain('Thanks');

    // The topic itself is untouched by a warning.
    const topic = await request(server)
      .get(`/api/v1/community/topics/${topicId}`)
      .set(as('parent'))
      .expect(200);
    expect((topic.body as Topic).status).toBe('visible');
  });

  it('moderators lock and pin; locked topics refuse student replies; students cannot pin', async () => {
    await request(server)
      .patch(`/api/v1/community/topics/${topicId}`)
      .set(as('student'))
      .send({ pinned: true })
      .expect(403);

    const locked = await request(server)
      .patch(`/api/v1/community/topics/${topicId}`)
      .set(as('teacher'))
      .send({ locked: true, pinned: true })
      .expect(200);
    expect((locked.body as Topic).locked).toBe(true);
    expect((locked.body as Topic).pinned).toBe(true);

    const denied = await request(server)
      .post(`/api/v1/community/topics/${topicId}/posts`)
      .set(as('student'))
      .send({ body: 'One more thought' })
      .expect(403);
    expect((denied.body as Problem).code).toBe('community.locked');

    const list = await request(server)
      .get(`/api/v1/community/groups/${classGroupId}/topics`)
      .set(as('student'))
      .expect(200);
    expect((list.body as { data: Topic[] }).data[0]?.id).toBe(topicId);

    await request(server)
      .patch(`/api/v1/community/topics/${topicId}`)
      .set(as('teacher'))
      .send({ locked: false })
      .expect(200);
  });

  it('reactions count once per person and subscriptions can be turned off', async () => {
    const liked = await request(server)
      .put(`/api/v1/community/posts/${teacherPostId}/reaction`)
      .set(as('student'))
      .send({ kind: 'helpful' })
      .expect(200);
    expect((liked.body as Post).reactions.helpful).toBe(1);
    expect((liked.body as Post).myReaction).toBe('helpful');

    const changed = await request(server)
      .put(`/api/v1/community/posts/${teacherPostId}/reaction`)
      .set(as('student'))
      .send({ kind: 'like' })
      .expect(200);
    expect((changed.body as Post).reactions).toEqual(
      expect.objectContaining({ like: 1, helpful: 0 }),
    );

    const cleared = await request(server)
      .delete(`/api/v1/community/posts/${teacherPostId}/reaction`)
      .set(as('student'))
      .expect(200);
    expect((cleared.body as Post).myReaction).toBeNull();

    const off = await request(server)
      .delete(`/api/v1/community/topics/${topicId}/subscribe`)
      .set(as('student'))
      .expect(200);
    expect((off.body as { subscribed: boolean }).subscribed).toBe(false);
  });

  it('a mute pauses a member, lifting it restores posting, and archiving keeps the group readable to members', async () => {
    await request(server)
      .patch(`/api/v1/community/groups/${clubId}/members/${ids.student}`)
      .set(as('teacher'))
      .send({ muteDays: 2 })
      .expect(200);
    const clubTopic = await request(server)
      .post(`/api/v1/community/groups/${clubId}/topics`)
      .set(as('student'))
      .send({ title: 'Opening moves', body: 'What do you play as white?' })
      .expect(403);
    expect((clubTopic.body as Problem).code).toBe('community.muted');

    await request(server)
      .patch(`/api/v1/community/groups/${clubId}/members/${ids.student}`)
      .set(as('teacher'))
      .send({ muteDays: 0 })
      .expect(200);
    await request(server)
      .post(`/api/v1/community/groups/${clubId}/topics`)
      .set(as('student'))
      .send({ title: 'Opening moves', body: 'What do you play as white?' })
      .expect(201);

    await request(server)
      .patch(`/api/v1/community/groups/${clubId}/members/${ids.student}`)
      .set(as('student'))
      .send({ role: 'moderator' })
      .expect(403);

    await request(server)
      .post(`/api/v1/community/groups/${clubId}/archive`)
      .set(as('teacher'))
      .expect(201);
    const still = await request(server)
      .get(`/api/v1/community/groups/${clubId}`)
      .set(as('student'))
      .expect(200);
    expect((still.body as Group).status).toBe('archived');
    expect((still.body as Group).canPost).toBe(false);
    const listed = await request(server)
      .get('/api/v1/community/groups')
      .set(as('student'))
      .expect(200);
    expect(
      (listed.body as { data: Group[] }).data.some((g) => g.id === clubId),
    ).toBe(false);
  });
});
