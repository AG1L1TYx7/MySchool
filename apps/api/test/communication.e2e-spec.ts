import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/infra/prisma/prisma.service';

const PASSWORD = 'SmartSchool!Demo2026';
const stamp = Date.now();

interface Problem {
  code: string;
  detail: string;
}
interface NotificationBody {
  id: string;
  category: string;
  title: string;
  link: string | null;
  isRead: boolean;
}
interface ConversationBody {
  id: string;
  type: string;
  title: string;
  unreadCount: number;
  participants: Array<{ id: string; role: string; lastReadAt: string | null }>;
  lastMessage: { content: string } | null;
}
interface MessageBody {
  id: string;
  content: string;
  sender: { id: string; firstName: string } | null;
  replyTo: { id: string; content: string } | null;
  editedAt: string | null;
  deletedAt: string | null;
}

/** Slice 7: announcements reach a class, notifications arrive (REST and live), teacher and student message each other. */
describe('Communication (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let baseUrl = '';
  const tokens: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  let classId = '';
  let announcementId = '';
  let conversationId = '';
  let messageId = '';
  const sockets: Socket[] = [];

  const login = async (role: string) => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: `${role}@smartschool.local`, password: PASSWORD })
      .expect(200);
    const body = res.body as { accessToken: string; user: { id: string } };
    tokens[role] = body.accessToken;
    userIds[role] = body.user.id;
  };
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });
  const connect = (namespace: string, role: string): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const socket = io(`${baseUrl}${namespace}`, {
        path: '/api/socket.io',
        auth: { token: tokens[role] },
        transports: ['websocket'],
        forceNew: true,
      });
      sockets.push(socket);
      socket.on('Connected', () => resolve(socket));
      socket.on('Error', (e: unknown) => reject(new Error(JSON.stringify(e))));
      socket.on('connect_error', reject);
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configureApp(
      moduleRef.createNestApplication<NestExpressApplication>({
        bodyParser: false,
      }),
    );
    await app.init();
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer() as Server;
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    prisma = app.get(PrismaService);
    await Promise.all(['teacher', 'student', 'parent', 'principal'].map(login));
    classId = (
      await prisma.class.findFirstOrThrow({
        where: { name: 'English 7 - Section A', deletedAt: null },
      })
    ).id;
    await prisma.notification.deleteMany({
      where: { recipientId: { in: Object.values(userIds) } },
    });
  });

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await prisma.announcement.deleteMany({
      where: { title: { contains: `E2E ${stamp}` } },
    });
    if (conversationId)
      await prisma.conversation.deleteMany({ where: { id: conversationId } });
    await app.close();
  });

  it('rejects sockets without a valid token', async () => {
    await expect(
      new Promise((resolve, reject) => {
        const s = io(`${baseUrl}/hubs/notifications`, {
          path: '/api/socket.io',
          auth: { token: 'nope' },
          transports: ['websocket'],
          forceNew: true,
        });
        sockets.push(s);
        s.on('Error', resolve);
        s.on('Connected', () => reject(new Error('should not connect')));
      }),
    ).resolves.toMatchObject({ code: 'auth.unauthorized' });
  });

  it('lets a teacher draft and publish a class announcement that students and parents see, and notifies them live', async () => {
    const studentHub = await connect('/hubs/notifications', 'student');
    const received = new Promise<NotificationBody>((resolve) =>
      studentHub.on('NewNotification', resolve),
    );

    await request(server)
      .post('/api/v1/announcements')
      .set(as('student'))
      .send({ title: 'x', content: 'y', classId })
      .expect(403);
    const schoolWide = await request(server)
      .post('/api/v1/announcements')
      .set(as('teacher'))
      .send({ title: `E2E ${stamp} school`, content: 'no' })
      .expect(403);
    expect((schoolWide.body as Problem).code).toBe('authz.forbidden');

    const draft = await request(server)
      .post('/api/v1/announcements')
      .set(as('teacher'))
      .send({
        title: `E2E ${stamp} Field trip`,
        content: 'Bring a signed form by Friday.',
        classId,
        type: 'event',
        priority: 'high',
      })
      .expect(201);
    announcementId = (draft.body as { id: string; status: string }).id;
    expect((draft.body as { status: string }).status).toBe('draft');
    const hidden = await request(server)
      .get('/api/v1/announcements')
      .set(as('student'))
      .expect(200);
    expect(
      (hidden.body as { data: Array<{ id: string }> }).data.some(
        (a) => a.id === announcementId,
      ),
    ).toBe(false);

    const published = await request(server)
      .post(`/api/v1/announcements/${announcementId}/publish`)
      .set(as('teacher'))
      .expect(200);
    expect(
      (published.body as { status: string; publishedAt: string }).publishedAt,
    ).toBeTruthy();
    const feed = await request(server)
      .get('/api/v1/announcements')
      .set(as('student'))
      .expect(200);
    const mine = (
      feed.body as {
        data: Array<{ id: string; priority: string; className: string }>;
      }
    ).data.find((a) => a.id === announcementId);
    expect(mine).toMatchObject({
      priority: 'high',
      className: 'English 7 - Section A',
    });
    const parentFeed = await request(server)
      .get('/api/v1/announcements')
      .set(as('parent'))
      .expect(200);
    expect(
      (parentFeed.body as { data: Array<{ id: string }> }).data.some(
        (a) => a.id === announcementId,
      ),
    ).toBe(true);

    const live = await received;
    expect(live.category).toBe('announcement');
    expect(live.title).toContain('Field trip');
    expect(live.link).toBe(`/announcements/${announcementId}`);
  });

  it('lists, summarises and marks notifications, and honours preferences', async () => {
    const list = await request(server)
      .get('/api/v1/notifications?unreadOnly=true')
      .set(as('student'))
      .expect(200);
    const rows = (list.body as { data: NotificationBody[] }).data;
    expect(
      rows.some(
        (n) => n.category === 'announcement' && n.title.includes('Field trip'),
      ),
    ).toBe(true);
    const summary = await request(server)
      .get('/api/v1/notifications/summary')
      .set(as('student'))
      .expect(200);
    expect(
      (summary.body as { unread: number; byCategory: Record<string, number> })
        .byCategory.announcement,
    ).toBeGreaterThanOrEqual(1);

    const first = rows[0];
    const read = await request(server)
      .post(`/api/v1/notifications/${first.id}/read`)
      .set(as('student'))
      .expect(200);
    expect((read.body as NotificationBody).isRead).toBe(true);
    await request(server)
      .post(`/api/v1/notifications/${first.id}/read`)
      .set(as('teacher'))
      .expect(404);
    await request(server)
      .post('/api/v1/notifications/read-all')
      .set(as('student'))
      .expect(200);
    const after = await request(server)
      .get('/api/v1/notifications/summary')
      .set(as('student'))
      .expect(200);
    expect((after.body as { unread: number }).unread).toBe(0);

    const prefs = await request(server)
      .put('/api/v1/notifications/preferences')
      .set(as('student'))
      .send({
        preferences: [{ category: 'announcement', inApp: false, email: false }],
      })
      .expect(200);
    expect(
      (
        prefs.body as { data: Array<{ category: string; inApp: boolean }> }
      ).data.find((p) => p.category === 'announcement')?.inApp,
    ).toBe(false);
    const draft2 = await request(server)
      .post('/api/v1/announcements')
      .set(as('teacher'))
      .send({
        title: `E2E ${stamp} muted`,
        content: 'quiet',
        classId,
        publish: true,
      })
      .expect(201);
    const count = await request(server)
      .get('/api/v1/notifications?unreadOnly=true&category=announcement')
      .set(as('student'))
      .expect(200);
    expect(
      (count.body as { data: NotificationBody[] }).data.some((n) =>
        n.title.includes('muted'),
      ),
    ).toBe(false);
    await request(server)
      .delete(`/api/v1/announcements/${(draft2.body as { id: string }).id}`)
      .set(as('teacher'))
      .expect(204);
    await request(server)
      .put('/api/v1/notifications/preferences')
      .set(as('student'))
      .send({
        preferences: [{ category: 'announcement', inApp: true, email: false }],
      })
      .expect(200);
  });

  it('enforces who may message whom', async () => {
    const contacts = await request(server)
      .get('/api/v1/conversations/contacts')
      .set(as('student'))
      .expect(200);
    const roles = new Set(
      (contacts.body as { data: Array<{ role: string }> }).data.map(
        (c) => c.role,
      ),
    );
    expect(roles.has('teacher')).toBe(true);
    expect(roles.has('student')).toBe(false);
    const blocked = await request(server)
      .post('/api/v1/conversations')
      .set(as('student'))
      .send({ type: 'direct', participantIds: [userIds.parent] })
      .expect(403);
    expect((blocked.body as Problem).code).toBe('messaging.not_allowed');
    await request(server)
      .post('/api/v1/conversations')
      .set(as('student'))
      .send({ type: 'group', participantIds: [userIds.teacher] })
      .expect(403);
  });

  it('starts a direct conversation, delivers messages live, tracks unread and read, edits and deletes', async () => {
    const teacherHub = await connect('/hubs/messaging', 'teacher');
    const created = await request(server)
      .post('/api/v1/conversations')
      .set(as('student'))
      .send({ type: 'direct', participantIds: [userIds.teacher] })
      .expect(201);
    const conv = created.body as ConversationBody;
    conversationId = conv.id;
    expect(conv.type).toBe('direct');
    expect(conv.title).toBe('Jane Teacher');
    const again = await request(server)
      .post('/api/v1/conversations')
      .set(as('student'))
      .send({ type: 'direct', participantIds: [userIds.teacher] })
      .expect(201);
    expect((again.body as ConversationBody).id).toBe(conversationId);

    await new Promise<void>((resolve) =>
      teacherHub.emit(
        'JoinConversation',
        { conversationId },
        (ack: { ok: boolean }) => (ack.ok ? resolve() : resolve()),
      ),
    );
    const liveMessage = new Promise<MessageBody>((resolve) =>
      teacherHub.on('ReceiveMessage', resolve),
    );
    const sent = await request(server)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set(as('student'))
      .send({ content: 'Could we go over question 3 tomorrow?' })
      .expect(201);
    messageId = (sent.body as MessageBody).id;
    expect((await liveMessage).id).toBe(messageId);

    const teacherList = await request(server)
      .get('/api/v1/conversations')
      .set(as('teacher'))
      .expect(200);
    const forTeacher = (
      teacherList.body as { data: ConversationBody[] }
    ).data.find((c) => c.id === conversationId);
    expect(forTeacher?.unreadCount).toBe(1);
    expect(forTeacher?.title).toBe('Emma Johnson');
    expect(forTeacher?.lastMessage?.content).toContain('question 3');
    const teacherNotes = await request(server)
      .get('/api/v1/notifications?category=message')
      .set(as('teacher'))
      .expect(200);
    expect(
      (teacherNotes.body as { data: NotificationBody[] }).data.some(
        (n) => n.link === `/messages/${conversationId}`,
      ),
    ).toBe(true);

    await request(server)
      .post(`/api/v1/conversations/${conversationId}/read`)
      .set(as('teacher'))
      .expect(200);
    const afterRead = await request(server)
      .get(`/api/v1/conversations/${conversationId}`)
      .set(as('teacher'))
      .expect(200);
    expect((afterRead.body as ConversationBody).unreadCount).toBe(0);

    const reply = await request(server)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set(as('teacher'))
      .send({ content: 'Yes, come by at 8.', replyToMessageId: messageId })
      .expect(201);
    expect((reply.body as MessageBody).replyTo?.id).toBe(messageId);
    const edited = await request(server)
      .patch(`/api/v1/messages/${messageId}`)
      .set(as('student'))
      .send({ content: 'Could we go over question 3 tomorrow morning?' })
      .expect(200);
    expect((edited.body as MessageBody).editedAt).toBeTruthy();
    await request(server)
      .patch(`/api/v1/messages/${messageId}`)
      .set(as('teacher'))
      .send({ content: 'nope' })
      .expect(403);
    await request(server)
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .set(as('parent'))
      .expect(404);

    const thread = await request(server)
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .set(as('student'))
      .expect(200);
    expect(
      (thread.body as { data: MessageBody[] }).data.map((m) => m.content),
    ).toEqual([
      'Could we go over question 3 tomorrow morning?',
      'Yes, come by at 8.',
    ]);
    await request(server)
      .delete(`/api/v1/messages/${(reply.body as MessageBody).id}`)
      .set(as('teacher'))
      .expect(204);
    const afterDelete = await request(server)
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .set(as('student'))
      .expect(200);
    expect(
      (afterDelete.body as { data: MessageBody[] }).data[1].deletedAt,
    ).toBeTruthy();
  });

  it('opens a class conversation for everyone in the class', async () => {
    const created = await request(server)
      .post('/api/v1/conversations')
      .set(as('teacher'))
      .send({ type: 'class', classId })
      .expect(201);
    const conv = created.body as ConversationBody;
    expect(conv.type).toBe('class');
    expect(conv.participants.some((p) => p.id === userIds.student)).toBe(true);
    await request(server)
      .post('/api/v1/conversations')
      .set(as('student'))
      .send({ type: 'class', classId })
      .expect(403);
    const asStudent = await request(server)
      .get(`/api/v1/conversations/${conv.id}`)
      .set(as('student'))
      .expect(200);
    expect((asStudent.body as ConversationBody).title).toBe(
      'English 7 - Section A',
    );
    await prisma.conversation.deleteMany({ where: { id: conv.id } });
  });
});
