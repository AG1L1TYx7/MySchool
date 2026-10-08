import { CodeRunnerService } from './code-runner.service';

describe('CodeRunnerService (sandbox)', () => {
  const runner = new CodeRunnerService();

  it('runs student code and judges each test', async () => {
    const r = await runner.run(
      'function add(a, b) { return a + b; }\nprint("ready");',
      [
        { expr: 'add(2, 3)', expected: '5' },
        { expr: 'add(1, 1)', expected: '3' },
      ],
    );
    expect(r.error).toBeNull();
    expect(r.output).toBe('ready');
    expect(r.outcomes.map((o) => o.passed)).toEqual([true, false]);
    expect(r.outcomes[1].got).toBe('2');
  });

  it('reports syntax and runtime errors without crashing', async () => {
    const bad = await runner.run('function add(a, b) { return a + ; }', [
      { expr: 'add(1, 2)', expected: '3' },
    ]);
    expect(bad.error).toMatch(/Unexpected token/);
    const thrower = await runner.run(
      'function add() { throw new Error("nope"); }',
      [{ expr: 'add()', expected: '1' }],
    );
    expect(thrower.outcomes[0]).toMatchObject({
      passed: false,
      got: 'Error: nope',
    });
  });

  it('stops an endless loop at the time limit, in a test and at load', async () => {
    const inTest = await runner.run('function spin() { while (true) {} }', [
      { expr: 'spin()', expected: '1' },
    ]);
    expect(inTest.outcomes[0].passed).toBe(false);
    expect(inTest.outcomes[0].got).toMatch(/timed out/i);
    const atLoad = await runner.run('while (true) {}', [
      { expr: '1', expected: '1' },
    ]);
    expect(atLoad.error).toMatch(/timed out|longer than/i);
  }, 20000);

  it('gives the code no way out of the sandbox', async () => {
    const r = await runner.run(
      'function probe() { return typeof require + "," + typeof process + "," + typeof fetch + "," + typeof setTimeout; }',
      [
        {
          expr: 'probe()',
          expected: '"undefined,undefined,undefined,undefined"',
        },
      ],
    );
    expect(r.outcomes[0].passed).toBe(true);
    const escape = await runner.run(
      'function esc() { return this.constructor.constructor("return process")(); }',
      [{ expr: 'typeof esc()', expected: '"undefined"' }],
    );
    expect(
      escape.outcomes[0].got === '"undefined"' ||
        /Error/.test(escape.outcomes[0].got),
    ).toBe(true);
  });
});
