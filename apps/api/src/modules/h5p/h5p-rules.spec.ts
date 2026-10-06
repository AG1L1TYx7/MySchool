import {
  sanitizeParameters,
  buildManifest,
  contentTypeFor,
  dependenciesFor,
  maxScoreOf,
  parseLibrary,
  scaledScore,
  signPlayTicket,
  validateParameters,
  verifyPlayTicket,
} from './h5p-rules';

const SECRET = 'unit-test-secret-that-is-long-enough-0123456789';

describe('h5p rules', () => {
  it('parses only libraries we serve, at the pinned major.minor', () => {
    expect(parseLibrary('H5P.QuestionSet 1.20')).toEqual({
      machineName: 'H5P.QuestionSet',
      majorVersion: 1,
      minorVersion: 20,
    });
    expect(parseLibrary('H5P.QuestionSet 1.19')).toBeNull();
    expect(parseLibrary('H5P.Evil 1.0')).toBeNull();
    expect(parseLibrary('garbage')).toBeNull();
    expect(contentTypeFor('H5P.Dialogcards 1.9')).toBe('flashcards');
  });

  it('validates question sets recursively and reports what the player would reject', () => {
    const mc = {
      library: 'H5P.MultiChoice 1.16',
      params: {
        question: '<p>q</p>',
        answers: [{ correct: true }, { correct: false }],
      },
    };
    expect(
      validateParameters('H5P.QuestionSet 1.20', { questions: [mc] }),
    ).toEqual([]);
    expect(
      validateParameters('H5P.QuestionSet 1.20', { questions: [] }),
    ).toEqual(['questions must be a non-empty list']);
    expect(
      validateParameters('H5P.QuestionSet 1.20', {
        questions: [
          {
            library: 'H5P.TrueFalse 1.8',
            params: { question: 'x', correct: 'maybe' },
          },
        ],
      }),
    ).toEqual(["question 1: correct must be 'true' or 'false'"]);
    expect(
      validateParameters('H5P.Blanks 1.14', { questions: ['no blank'] }),
    ).toEqual(['each blank must be marked with *answer*']);
    expect(
      validateParameters('H5P.Dialogcards 1.9', { dialogs: [{ text: 'a' }] }),
    ).toEqual(['card 1: text and answer are required']);
    expect(validateParameters('H5P.QuestionSet 1.20', 'nope')).toEqual([
      'parameters must be an object',
    ]);
  });

  it('scores one point per question or card and scales results onto assignment points', () => {
    expect(maxScoreOf('H5P.QuestionSet 1.20', { questions: [1, 2, 3] })).toBe(
      3,
    );
    expect(maxScoreOf('H5P.Dialogcards 1.9', { dialogs: [1, 2] })).toBe(2);
    expect(scaledScore(2, 3, 10)).toBe(6.67);
    expect(scaledScore(5, 3, 10)).toBe(10);
    expect(scaledScore(1, 0, 10)).toBe(0);
  });

  it('builds a manifest whose dependencies are closed and ordered before the main library', () => {
    const deps = dependenciesFor('H5P.QuestionSet').map((d) => d.machineName);
    expect(deps.indexOf('H5P.JoubelUI')).toBeLessThan(
      deps.indexOf('H5P.QuestionSet'),
    );
    expect(deps).toEqual(
      expect.arrayContaining([
        'FontAwesome',
        'H5P.Question',
        'H5P.MultiChoice',
        'H5P.TrueFalse',
        'H5P.Blanks',
      ]),
    );
    const manifest = buildManifest('Quiz', 'H5P.QuestionSet 1.20') as {
      mainLibrary: string;
      preloadedDependencies: Array<{
        machineName: string;
        majorVersion: string;
      }>;
    };
    expect(manifest.mainLibrary).toBe('H5P.QuestionSet');
    expect(
      manifest.preloadedDependencies.find(
        (d) => d.machineName === 'H5P.QuestionSet',
      )?.majorVersion,
    ).toBe('1');
  });

  it('signs play tickets that expire and cannot be tampered with', () => {
    const ticket = {
      contentId: 'c1',
      userId: 'u1',
      assignmentId: null,
      exp: Math.floor(Date.now() / 1000) + 60,
    };
    const token = signPlayTicket(ticket, SECRET);
    expect(verifyPlayTicket(token, SECRET)).toEqual(ticket);
    expect(
      verifyPlayTicket(token, 'another-secret-that-is-long-enough-0123456789'),
    ).toBeNull();
    const [payload] = token.split('.');
    expect(verifyPlayTicket(`${payload}.forged`, SECRET)).toBeNull();
    expect(verifyPlayTicket(token, SECRET, (ticket.exp + 1) * 1000)).toBeNull();
  });
});

describe('sanitizeParameters', () => {
  it('keeps formatting and removes anything that runs', () => {
    const out = sanitizeParameters({
      question:
        '<p>Which?</p><script>alert(1)</script><img src=x onerror="alert(2)">',
      answers: [
        { text: '<div onclick="steal()">Right</div>', correct: true },
        {
          text: '<b>Wrong</b><iframe src="https://evil.example"></iframe>',
          correct: false,
        },
        {
          text: '<a href="javascript:alert(3)">link</a> <a href="https://ok.example">ok</a>',
        },
      ],
      nested: { deep: ['<style>body{}</style>plain', 7, null, true] },
    });
    const text = JSON.stringify(out);
    expect(text).not.toMatch(
      /<script|onerror|onclick|<iframe|<style|javascript:/i,
    );
    expect(out.question.startsWith('<p>Which?</p>')).toBe(true);
    expect(out.answers[0].text).toBe('<div>Right</div>');
    expect(out.answers[1].text).toBe('<b>Wrong</b>');
    expect(out.answers[2].text).toContain('href="https://ok.example"');
    expect(out.answers[0].correct).toBe(true);
    expect(out.nested.deep).toEqual(['plain', 7, null, true]);
  });
});
