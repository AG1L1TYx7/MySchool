import { createServer, type Server } from 'node:http';

/**
 * A stand-in for the AI service used by the e2e suite: honours the service token, answers
 * tutor calls with a deterministic Result Envelope (JSON or SSE), indexes nothing, reports healthy.
 */
export function startAiStub(
  token: string,
  port = 0,
): Promise<{
  server: Server;
  url: string;
  calls: Array<Record<string, unknown>>;
}> {
  const calls: Array<Record<string, unknown>> = [];
  const jobs: Record<string, Record<string, unknown>> = {};
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'healthy',
            provider: 'fake',
            models: { 'llama3.1:8b': true },
            promptVersions: ['tutor.chat@1'],
          }),
        );
        return;
      }
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401, { 'content-type': 'application/problem+json' });
        res.end(JSON.stringify({ code: 'ai.unauthorized' }));
        return;
      }
      const envelope = body
        ? (JSON.parse(body) as Record<string, unknown>)
        : {};
      if (body) calls.push(envelope);
      if (req.url === '/v1/content/generate') {
        const spec = envelope.request as { topic: string; count: number };
        const id = `job-${calls.length}`;
        jobs[id] = /fail/i.test(spec.topic)
          ? {
              jobId: id,
              status: 'failed',
              progress: 'Failed',
              result: null,
              error: { code: 'ai.invalid_output', detail: 'stub failure' },
            }
          : {
              jobId: id,
              status: 'done',
              progress: 'Done',
              error: null,
              result: stubResult(envelope.capability as string, spec),
            };
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jobId: id, status: 'queued' }));
        return;
      }
      if (req.url?.startsWith('/v1/jobs/')) {
        const job = jobs[decodeURIComponent(req.url.slice('/v1/jobs/'.length))];
        res.writeHead(job ? 200 : 404, { 'content-type': 'application/json' });
        res.end(JSON.stringify(job ?? { code: 'resource.not_found' }));
        return;
      }
      if (req.url === '/v1/rag/index') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            documents: (envelope.documents as unknown[]).length,
            chunks: (envelope.documents as unknown[]).length * 2,
            total: 4,
          }),
        );
        return;
      }
      if (req.url === '/v1/tutor/chat') {
        const input = envelope.input as {
          messages: Array<{ content: string }>;
        };
        const last = input.messages[input.messages.length - 1].content;
        const options = envelope.options as { stream?: boolean };
        const refused = /want to die/i.test(last);
        const result = {
          traceId: envelope.traceId,
          capability: envelope.capability,
          promptVersion: 'tutor.chat@1',
          model: { provider: 'fake', name: 'fake' },
          output: refused
            ? {
                content: 'Please talk to a trusted adult.',
                citations: [],
                nextSteps: [],
              }
            : {
                content: `Stub answer to: ${last} [C1] What is the next step?`,
                citations: [{ blockId: 'C1', label: 'Lesson' }],
                nextSteps: ['What is the next step?'],
              },
          safety: refused
            ? { input: 'escalate', output: 'allow', categories: ['self_harm'] }
            : { input: 'allow', output: 'allow', categories: [] },
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            latencyMs: 12,
            toolCalls: 0,
          },
          status: refused ? 'refused' : 'ok',
        };
        if (options?.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write(
            `event: token\ndata: ${JSON.stringify({ t: 'Stub ' })}\n\n`,
          );
          res.write(
            `event: token\ndata: ${JSON.stringify({ t: 'answer' })}\n\n`,
          );
          res.write(`event: result\ndata: ${JSON.stringify(result)}\n\n`);
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}`, calls });
    });
  });
}

function stubResult(
  capability: string,
  spec: { topic: string; count: number },
) {
  const mc = (n: number) => ({
    library: 'H5P.MultiChoice 1.16',
    params: {
      question: `<p>${spec.topic} question ${n}</p>`,
      answers: [
        { text: '<div>Right</div>', correct: true },
        { text: '<div>Wrong</div>', correct: false },
      ],
    },
    subContentId: `sub-${n}`,
    metadata: { contentType: 'Multiple Choice', license: 'U', title: `Q${n}` },
  });
  if (capability === 'content.flashcards') {
    const dialogs = Array.from({ length: spec.count }, (_, i) => ({
      text: `<p>Front ${i + 1}</p>`,
      answer: `<p>Back ${i + 1}</p>`,
      tips: { front: '', back: '' },
    }));
    return {
      promptVersion: 'content.flashcards@1',
      model: { provider: 'fake', name: 'fake' },
      draft: {
        title: `${spec.topic} cards`,
        cards: dialogs.map((d) => ({ front: d.text, back: d.answer })),
      },
      h5p: {
        library: 'H5P.Dialogcards 1.9',
        title: `${spec.topic} cards`,
        params: { title: '<p>t</p>', dialogs },
        maxScore: dialogs.length,
      },
      validation: { valid: true, errors: [] },
      usage: { promptTokens: 1, completionTokens: 1, latencyMs: 5, repairs: 0 },
      cached: false,
    };
  }
  const questions = Array.from({ length: spec.count }, (_, i) => mc(i + 1));
  return {
    promptVersion: 'content.quiz@1',
    model: { provider: 'fake', name: 'fake' },
    draft: {
      title: `${spec.topic} quiz`,
      questions: questions.map((q, i) => ({
        type: 'multiple_choice',
        prompt: `${spec.topic} question ${i + 1}`,
        options: ['Right', 'Wrong'],
        answer: 'Right',
      })),
    },
    h5p: {
      library: 'H5P.QuestionSet 1.20',
      title: `${spec.topic} quiz`,
      params: { questions },
      maxScore: questions.length,
    },
    validation: { valid: true, errors: [] },
    usage: { promptTokens: 1, completionTokens: 1, latencyMs: 5, repairs: 0 },
    cached: false,
  };
}
