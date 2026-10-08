import { Injectable, Logger } from '@nestjs/common';
import { Worker } from 'node:worker_threads';
import {
  CODE_LIMITS,
  compareResult,
  type CodeTest,
  type TestOutcome,
} from './careers-rules';

export interface RunResult {
  outcomes: TestOutcome[];
  output: string;
  error: string | null;
  runtimeMs: number;
}

/**
 * The JavaScript-only isolate of ADR-013: student code runs in a worker thread with a memory cap, inside a
 * fresh V8 context whose global object has no prototype and holds nothing from the host realm; it has no
 * require, process, fetch or timers, code generation from strings is off, and the worker is terminated at
 * the time limit. Each test expression is evaluated in that context and compared with the expected JSON value.
 */
@Injectable()
export class CodeRunnerService {
  private readonly log = new Logger(CodeRunnerService.name);

  available(): boolean {
    return true;
  }

  async run(source: string, tests: CodeTest[]): Promise<RunResult> {
    const started = Date.now();
    if (source.length > CODE_LIMITS.sourceMaxChars)
      return {
        outcomes: [],
        output: '',
        error: `Code is longer than ${CODE_LIMITS.sourceMaxChars} characters.`,
        runtimeMs: 0,
      };
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      resourceLimits: {
        maxOldGenerationSizeMb: CODE_LIMITS.memoryMb,
        maxYoungGenerationSizeMb: 16,
      },
      workerData: {
        source,
        tests: tests.map((t) => t.expr),
        outputMax: CODE_LIMITS.outputMaxChars,
      },
      stdout: true,
      stderr: true,
    });
    type Message = {
      results?: Array<{ ok: boolean; value?: unknown; error?: string }>;
      output: string;
      error: string | null;
    };
    const result = await new Promise<Message>((resolve) => {
      let settled = false;
      const done = (v: Message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        resolve(v);
      };
      const timer = setTimeout(
        () =>
          done({
            output: '',
            error: `Took longer than ${CODE_LIMITS.timeoutMs / 1000} seconds. Is there an endless loop?`,
          }),
        CODE_LIMITS.timeoutMs,
      );
      worker.on('message', (m: Message) => done(m));
      worker.on('error', (err: Error) =>
        done({
          output: '',
          error: /heap|memory/i.test(err.message)
            ? `Used more than ${CODE_LIMITS.memoryMb} MB of memory.`
            : err.message.slice(0, 500),
        }),
      );
      worker.on('exit', (code) => {
        if (!settled)
          done({
            output: '',
            error:
              code === 0
                ? 'The program ended without reporting results.'
                : `The program stopped (exit code ${code}).`,
          });
      });
    });
    const outcomes: TestOutcome[] = tests.map((t, i) => {
      const r = result.results?.[i];
      const got = r?.ok ? r.value : undefined;
      return {
        label: t.label ?? t.expr,
        passed: !!r?.ok && compareResult(t.expected, got),
        expected: t.expected,
        got: r
          ? r.ok
            ? safeJson(r.value)
            : `Error: ${r.error ?? 'unknown'}`
          : '(not run)',
      };
    });
    if (result.error) this.log.debug(`code run error: ${result.error}`);
    return {
      outcomes,
      output: result.output.slice(0, CODE_LIMITS.outputMaxChars),
      error: result.error,
      runtimeMs: Date.now() - started,
    };
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/**
 * Runs inside the worker. print() and console are defined by code that runs in the context itself, so no host
 * function or object is reachable; the classic this.constructor.constructor route only finds the context's own
 * Function, where code generation from strings is switched off.
 */
const WORKER_SOURCE = [
  "const { parentPort, workerData } = require('node:worker_threads');",
  "const vm = require('node:vm');",
  'const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });',
  'vm.runInContext(',
  "  'var __out = []; var __max = ' + Number(workerData.outputMax) + ';' +",
  '  \'function print() { var parts = []; for (var i = 0; i < arguments.length; i++) { var a = arguments[i]; parts.push(typeof a === "string" ? a : JSON.stringify(a)); } if (__out.join("\\\\n").length < __max) __out.push(parts.join(" ")); }\' +',
  "  'var console = { log: print };',",
  '  context,',
  "  { filename: 'runtime.js' },",
  ');',
  'let error = null;',
  'const results = [];',
  'try {',
  "  vm.runInContext(workerData.source, context, { timeout: 1500, filename: 'student.js' });",
  '  for (const expr of workerData.tests) {',
  '    try {',
  "      const value = vm.runInContext(expr, context, { timeout: 500, filename: 'test.js' });",
  '      results.push({ ok: true, value: value === undefined ? null : JSON.parse(JSON.stringify(value)) });',
  '    } catch (e) {',
  '      results.push({ ok: false, error: String(e && e.message ? e.message : e).slice(0, 300) });',
  '    }',
  '  }',
  '} catch (e) {',
  '  error = String(e && e.message ? e.message : e).slice(0, 500);',
  '}',
  "let output = '';",
  "try { output = vm.runInContext('__out.join(\"\\\\n\")', context, { timeout: 200 }); } catch { output = ''; }",
  'parentPort.postMessage({ results, output: String(output), error });',
].join('\n');
