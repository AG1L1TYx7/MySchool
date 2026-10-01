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
      calls.push(envelope);
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
