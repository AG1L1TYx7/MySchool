import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AI_STUB_PORT, AI_STUB_TOKEN } from './ai-env';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { newId } from '../src/common/utils/ids';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { startAiStub } from './ai-stub';

interface Problem {
  code: string;
}
interface Item {
  id: string;
  title: string;
  kind: string;
  status: string;
  visibility: string;
  version: number;
  h5pContentId: string | null;
  sourceItemId: string | null;
  counts: { views: number; downloads: number; copies: number };
  rating: { average: number | null; count: number };
  canEdit: boolean;
  canReview: boolean;
}
interface Paged<T> {
  data: T[];
}
interface Collection {
  id: string;
  title: string;
  itemCount: number;
  following: boolean;
  items?: Item[];
}

const PASSWORD = 'SmartSchool!Demo2026';

/**
 * Library (slice 22): items of four kinds, visibility by school, district and everyone, review before wider
 * reach, versions and restore, ratings, reports, copies, collections, semantic search and downloads.
 */
describe('Library (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let stub: Awaited<ReturnType<typeof startAiStub>>;
  const tokens: Record<string, string> = {};
  const stamp = Date.now();
  let orgId = '';
  let teacherId = '';
  let h5pId = '';
  let fileId = '';
  let itemId = '';
  let docId = '';
  let linkId = '';

  const login = async (role: string, email = `${role}@smartschool.local`) => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    tokens[role] = (res.body as { accessToken: string }).accessToken;
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
    await Promise.all(
      ['teacher', 'principal', 'student', 'superintendent', 'parent'].map((r) =>
        login(r),
      ),
    );
    const teacher = await prisma.user.findFirstOrThrow({
      where: { email: 'teacher@smartschool.local' },
    });
    teacherId = teacher.id;
    orgId = teacher.organizationId ?? '';
    const h5p = await prisma.h5PContent.create({
      data: {
        id: newId(),
        organizationId: orgId,
        createdById: teacherId,
        title: `Library quiz ${stamp}`,
        library: 'H5P.MultiChoice 1.16',
        contentType: 'quiz',
        parameters: JSON.stringify({
          question: 'What is 2 + 2?',
          answers: [
            { text: '4', correct: true },
            { text: '5', correct: false },
          ],
        }),
        status: 'PUBLISHED',
        maxScore: 1,
        subject: 'Math',
        gradeLevel: '5',
      },
    });
    h5pId = h5p.id;
    const up = await request(server)
      .post('/api/v1/files')
      .set(as('teacher'))
      .attach(
        'file',
        Buffer.from('Photosynthesis notes for grade 7'),
        'photosynthesis.txt',
      )
      .expect(201);
    fileId = (up.body as { id: string }).id;
  });

  afterAll(async () => {
    await app?.close();
    stub.server.close();
  });

  it('lets staff add items of each kind and refuses students and unsafe links', async () => {
    await request(server)
      .post('/api/v1/library/items')
      .set(as('student'))
      .send({ kind: 'link', title: 'x', url: 'https://x.org' })
      .expect(403);
    const bad = await request(server)
      .post('/api/v1/library/items')
      .set(as('teacher'))
      .send({ kind: 'link', title: 'Bad link', url: 'javascript:alert(1)' })
      .expect(400);
    expect((bad.body as Problem).code).toBe('request.invalid');
    await request(server)
      .post('/api/v1/library/items')
      .set(as('teacher'))
      .send({ kind: 'h5p', title: 'No content' })
      .expect(400);

    const quiz = await request(server)
      .post('/api/v1/library/items')
      .set(as('teacher'))
      .send({
        kind: 'h5p',
        title: `Fractions warm-up ${stamp}`,
        description: 'Ten quick items on equivalent fractions',
        subject: 'Math',
        gradeLevel: '5',
        topics: ['fractions'],
        standards: ['CCSS.MATH.5.NF.1'],
        keywords: 'denominator numerator',
        h5pContentId: h5pId,
      })
      .expect(201);
    const q = quiz.body as Item;
    expect(q).toMatchObject({
      status: 'draft',
      visibility: 'private',
      version: 1,
      canEdit: true,
    });
    itemId = q.id;

    const doc = await request(server)
      .post('/api/v1/library/items')
      .set(as('teacher'))
      .send({
        kind: 'document',
        title: `Photosynthesis notes ${stamp}`,
        subject: 'Science',
        gradeLevel: '7',
        fileId,
        visibility: 'school',
      })
      .expect(201);
    docId = (doc.body as Item).id;
    const link = await request(server)
      .post('/api/v1/library/items')
      .set(as('teacher'))
      .send({
        kind: 'link',
        title: `Khan fractions ${stamp}`,
        url: 'https://www.khanacademy.org/math/fractions',
        subject: 'Math',
        visibility: 'school',
      })
      .expect(201);
    linkId = (link.body as Item).id;
    const meta = await request(server)
      .get('/api/v1/library/meta')
      .set(as('student'))
      .expect(200);
    expect((meta.body as { kinds: string[] }).kinds).toContain('lesson_plan');
  });

  it('keeps drafts private, shows school items once published, and counts views', async () => {
    await request(server)
      .get(`/api/v1/library/items/${itemId}`)
      .set(as('student'))
      .expect(404);
    const before = await request(server)
      .get('/api/v1/library/items?pageSize=100')
      .set(as('student'))
      .expect(200);
    expect((before.body as Paged<Item>).data.map((i) => i.id)).not.toContain(
      itemId,
    );

    await request(server)
      .patch(`/api/v1/library/items/${itemId}`)
      .set(as('teacher'))
      .send({ visibility: 'school' })
      .expect(200);
    const published = await request(server)
      .post(`/api/v1/library/items/${itemId}/publish`)
      .set(as('teacher'))
      .expect(201);
    expect((published.body as Item).status).toBe('published');
    for (const id of [docId, linkId])
      await request(server)
        .post(`/api/v1/library/items/${id}/publish`)
        .set(as('teacher'))
        .expect(201);

    const after = await request(server)
      .get('/api/v1/library/items?pageSize=100&subject=Math')
      .set(as('student'))
      .expect(200);
    expect((after.body as Paged<Item>).data.map((i) => i.id)).toEqual(
      expect.arrayContaining([itemId, linkId]),
    );
    const seen = await request(server)
      .get(`/api/v1/library/items/${itemId}`)
      .set(as('student'))
      .expect(200);
    expect((seen.body as Item).canEdit).toBe(false);
    const again = await request(server)
      .get(`/api/v1/library/items/${itemId}`)
      .set(as('student'))
      .expect(200);
    expect((again.body as Item).counts.views).toBeGreaterThanOrEqual(1);
    // A parent of the same school sees school items too.
    await request(server)
      .get(`/api/v1/library/items/${itemId}`)
      .set(as('parent'))
      .expect(200);
  });

  it('records versions on content changes and restores an earlier one', async () => {
    const edited = await request(server)
      .patch(`/api/v1/library/items/${linkId}`)
      .set(as('teacher'))
      .send({
        title: `Khan fractions (updated) ${stamp}`,
        versionNote: 'Renamed',
      })
      .expect(200);
    expect((edited.body as Item).version).toBe(2);
    const meta = await request(server)
      .patch(`/api/v1/library/items/${linkId}`)
      .set(as('teacher'))
      .send({ keywords: 'khan, video' })
      .expect(200);
    expect((meta.body as Item).version).toBe(2);
    const versions = await request(server)
      .get(`/api/v1/library/items/${linkId}/versions`)
      .set(as('student'))
      .expect(200);
    expect(
      (versions.body as Array<{ version: number; note: string | null }>).map(
        (v) => v.version,
      ),
    ).toEqual([2, 1]);
    const restored = await request(server)
      .post(`/api/v1/library/items/${linkId}/versions/1/restore`)
      .set(as('teacher'))
      .expect(201);
    expect(restored.body).toMatchObject({
      version: 3,
      title: `Khan fractions ${stamp}`,
    });
    await request(server)
      .post(`/api/v1/library/items/${linkId}/versions/1/restore`)
      .set(as('student'))
      .expect(403);
  });

  it('finds items by meaning through the AI service and by keyword', async () => {
    const res = await request(server)
      .get('/api/v1/library/items/search')
      .query({ q: 'equivalent fractions practice' })
      .set(as('student'))
      .expect(200);
    const body = res.body as {
      semantic: boolean;
      data: Array<Item & { score: number | null }>;
    };
    expect(body.semantic).toBe(true);
    const hit = body.data.find((i) => i.id === itemId);
    expect(hit).toBeDefined();
    expect(hit?.score).not.toBeNull();
    const keyword = await request(server)
      .get('/api/v1/library/items/search')
      .query({ q: 'Photosynthesis', kind: 'document' })
      .set(as('student'))
      .expect(200);
    expect((keyword.body as { data: Item[] }).data.map((i) => i.id)).toContain(
      docId,
    );
  });

  it('takes ratings from readers but not from the creator', async () => {
    const own = await request(server)
      .post(`/api/v1/library/items/${itemId}/rate`)
      .set(as('teacher'))
      .send({ stars: 5 })
      .expect(400);
    expect((own.body as Problem).code).toBe('library.own_item');
    const rated = await request(server)
      .post(`/api/v1/library/items/${itemId}/rate`)
      .set(as('student'))
      .send({ stars: 4, comment: 'Clear' })
      .expect(201);
    expect((rated.body as Item).rating).toEqual({ average: 4, count: 1 });
    const again = await request(server)
      .post(`/api/v1/library/items/${itemId}/rate`)
      .set(as('student'))
      .send({ stars: 5 })
      .expect(201);
    expect((again.body as Item).rating).toEqual({ average: 5, count: 1 });
  });

  it('sends wider reach through review: a principal approves district, a district role approves public', async () => {
    const wider = await request(server)
      .patch(`/api/v1/library/items/${itemId}`)
      .set(as('teacher'))
      .send({ visibility: 'district' })
      .expect(200);
    expect((wider.body as Item).status).toBe('pending_review');
    await request(server)
      .get(`/api/v1/library/items/${itemId}`)
      .set(as('student'))
      .expect(404);
    await request(server)
      .get('/api/v1/library/moderation')
      .set(as('teacher'))
      .expect(403);
    const queue = await request(server)
      .get('/api/v1/library/moderation')
      .set(as('principal'))
      .expect(200);
    expect(
      (queue.body as { pending: Item[] }).pending.map((i) => i.id),
    ).toContain(itemId);
    const approved = await request(server)
      .post(`/api/v1/library/items/${itemId}/review`)
      .set(as('principal'))
      .send({ decision: 'approve', note: 'Looks good' })
      .expect(201);
    expect((approved.body as Item).status).toBe('published');
    await request(server)
      .get(`/api/v1/library/items/${itemId}`)
      .set(as('student'))
      .expect(200);

    const pub = await request(server)
      .patch(`/api/v1/library/items/${itemId}`)
      .set(as('teacher'))
      .send({ visibility: 'public' })
      .expect(200);
    expect((pub.body as Item).status).toBe('pending_review');
    await request(server)
      .post(`/api/v1/library/items/${itemId}/review`)
      .set(as('principal'))
      .send({ decision: 'approve' })
      .expect(403);
    const supQueue = await request(server)
      .get('/api/v1/library/moderation')
      .set(as('superintendent'))
      .expect(200);
    expect(
      (supQueue.body as { pending: Item[] }).pending.map((i) => i.id),
    ).toContain(itemId);
    await request(server)
      .post(`/api/v1/library/items/${itemId}/review`)
      .set(as('superintendent'))
      .send({ decision: 'approve' })
      .expect(201);
    const back = await request(server)
      .patch(`/api/v1/library/items/${itemId}`)
      .set(as('teacher'))
      .send({ visibility: 'school' })
      .expect(200);
    expect((back.body as Item).status).toBe('published');
  });

  it('lets readers report an item and moderators take it down', async () => {
    const flag = await request(server)
      .post(`/api/v1/library/items/${linkId}/flag`)
      .set(as('student'))
      .send({ reason: 'broken', details: 'Page does not load' })
      .expect(201);
    const flagId = (flag.body as { id: string }).id;
    const queue = await request(server)
      .get('/api/v1/library/moderation')
      .set(as('principal'))
      .expect(200);
    expect(
      (queue.body as { flags: Array<{ id: string }> }).flags.map((f) => f.id),
    ).toContain(flagId);
    await request(server)
      .post(`/api/v1/library/flags/${flagId}/resolve`)
      .set(as('principal'))
      .send({ action: 'unpublish', note: 'Link is dead' })
      .expect(201);
    await request(server)
      .get(`/api/v1/library/items/${linkId}`)
      .set(as('student'))
      .expect(404);
    const mine = await request(server)
      .get('/api/v1/library/items?mine=true&status=rejected')
      .set(as('teacher'))
      .expect(200);
    expect((mine.body as Paged<Item>).data.map((i) => i.id)).toContain(linkId);
  });

  it("copies an item into the reader's own school as a private draft", async () => {
    await request(server)
      .post(`/api/v1/library/items/${itemId}/copy`)
      .set(as('student'))
      .expect(403);
    const copy = await request(server)
      .post(`/api/v1/library/items/${itemId}/copy`)
      .set(as('principal'))
      .expect(201);
    const c = copy.body as Item;
    expect(c).toMatchObject({
      status: 'draft',
      visibility: 'private',
      sourceItemId: itemId,
      kind: 'h5p',
    });
    expect(c.h5pContentId).not.toBe(h5pId);
    const original = await request(server)
      .get(`/api/v1/library/items/${itemId}`)
      .set(as('teacher'))
      .expect(200);
    expect((original.body as Item).counts.copies).toBe(1);
  });

  it('curates collections readers can follow', async () => {
    const created = await request(server)
      .post('/api/v1/library/collections')
      .set(as('teacher'))
      .send({ title: `Grade 5 fractions ${stamp}`, visibility: 'school' })
      .expect(201);
    const collectionId = (created.body as Collection).id;
    await request(server)
      .post(`/api/v1/library/collections/${collectionId}/items`)
      .set(as('teacher'))
      .send({ itemId })
      .expect(201);
    await request(server)
      .post(`/api/v1/library/collections/${collectionId}/items`)
      .set(as('student'))
      .send({ itemId })
      .expect(403);
    const list = await request(server)
      .get('/api/v1/library/collections')
      .set(as('student'))
      .expect(200);
    expect(
      (list.body as Collection[]).find((c) => c.id === collectionId)?.itemCount,
    ).toBe(1);
    const followed = await request(server)
      .post(`/api/v1/library/collections/${collectionId}/follow`)
      .set(as('student'))
      .expect(201);
    expect((followed.body as Collection).following).toBe(true);
    expect((followed.body as Collection).items?.map((i) => i.id)).toContain(
      itemId,
    );
    const inCollection = await request(server)
      .get(`/api/v1/library/items?collectionId=${collectionId}`)
      .set(as('student'))
      .expect(200);
    expect((inCollection.body as Paged<Item>).data.map((i) => i.id)).toEqual([
      itemId,
    ]);
    await request(server)
      .delete(`/api/v1/library/collections/${collectionId}/items/${itemId}`)
      .set(as('teacher'))
      .expect(200);
  });

  it('serves the document behind an item and removes items on request', async () => {
    const dl = await request(server)
      .get(`/api/v1/library/items/${docId}/download`)
      .set(as('student'))
      .expect(200);
    expect(dl.text).toContain('Photosynthesis notes');
    await request(server)
      .delete(`/api/v1/library/items/${docId}`)
      .set(as('student'))
      .expect(403);
    await request(server)
      .delete(`/api/v1/library/items/${docId}`)
      .set(as('teacher'))
      .expect(204);
    await request(server)
      .get(`/api/v1/library/items/${docId}`)
      .set(as('teacher'))
      .expect(404);
  });
});
