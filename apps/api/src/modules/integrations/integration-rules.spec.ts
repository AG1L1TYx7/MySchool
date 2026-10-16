import {
  apiKeyMatches,
  autoPostForm,
  canvasGradebookCsv,
  checkLaunchClaims,
  commonCartridgeManifest,
  eventMatches,
  generateApiKey,
  googleClassroomCsv,
  isAllowedWebhookUrl,
  launchPathFor,
  LTI_CLAIM,
  ltiRolesFor,
  nextDeliveryState,
  parseApiKey,
  parseEventFilter,
  parseScopes,
  platformLaunchClaims,
  roleFromLtiRoles,
  signWebhook,
  takeRateToken,
  toolConfiguration,
  verifyWebhookSignature,
  type ExportBook,
  clientAssertionClaims,
  deepLinkContentItem,
  deepLinkingResponseClaims,
  launchServices,
  LTI_AGS_CLAIM,
  LTI_DL_CLAIM,
  LTI_NRPS_CLAIM,
  membersToRoster,
  nextPageFrom,
  scorePayload,
  scoreUrl,
  checkDeepLinkingResponse,
  lineItemView,
  membershipsView,
  resultView,
  scoreToPercentage,
  signServiceToken,
  verifyServiceToken,
  LTI_SCOPE,
} from './integration-rules';

describe('webhook rules', () => {
  it('matches exact types and dotted prefixes; an empty filter takes everything', () => {
    expect(eventMatches([], 'grade.posted')).toBe(true);
    expect(eventMatches(['grade.posted'], 'grade.posted')).toBe(true);
    expect(eventMatches(['assignment.'], 'assignment.submitted')).toBe(true);
    expect(eventMatches(['assignment.'], 'grade.posted')).toBe(false);
    expect(parseEventFilter('["a.b", 3, "c."]')).toEqual(['a.b', 'c.']);
    expect(parseEventFilter('nonsense')).toEqual([]);
  });

  it('signs with the timestamp and the body, and verifies in constant time', () => {
    const sig = signWebhook('s3cret', '1700000000', '{"a":1}');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature('s3cret', '1700000000', '{"a":1}', sig)).toBe(
      true,
    );
    expect(verifyWebhookSignature('s3cret', '1700000001', '{"a":1}', sig)).toBe(
      false,
    );
    expect(verifyWebhookSignature('other', '1700000000', '{"a":1}', sig)).toBe(
      false,
    );
    expect(
      verifyWebhookSignature('s3cret', '1700000000', '{"a":1}', 'sha256=short'),
    ).toBe(false);
  });

  it('backs off 1, 2, 4, 8, 16 minutes and fails after the retry limit', () => {
    const now = new Date('2026-10-07T10:00:00Z');
    expect(nextDeliveryState(0, true, 5, now)).toMatchObject({
      status: 'delivered',
      attempts: 1,
    });
    const first = nextDeliveryState(0, false, 5, now);
    expect(first).toMatchObject({ status: 'pending', attempts: 1 });
    expect(first.nextAttemptAt.getTime() - now.getTime()).toBe(60_000);
    expect(
      nextDeliveryState(2, false, 5, now).nextAttemptAt.getTime() -
        now.getTime(),
    ).toBe(4 * 60_000);
    expect(
      nextDeliveryState(4, false, 5, now).nextAttemptAt.getTime() -
        now.getTime(),
    ).toBe(16 * 60_000);
    expect(nextDeliveryState(5, false, 5, now)).toMatchObject({
      status: 'failed',
      attempts: 6,
    });
  });

  it('allows https anywhere and http only on localhost', () => {
    expect(isAllowedWebhookUrl('https://sis.district.org/hooks')).toBe(true);
    expect(isAllowedWebhookUrl('http://localhost:9999/hook')).toBe(true);
    expect(isAllowedWebhookUrl('http://sis.district.org/hooks')).toBe(false);
    expect(isAllowedWebhookUrl('ftp://x')).toBe(false);
    expect(isAllowedWebhookUrl('not a url')).toBe(false);
  });
});

describe('API key rules', () => {
  it('generates a key that parses, hashes and matches only itself', () => {
    const k = generateApiKey();
    expect(k.plain).toMatch(/^ssk_[0-9a-f]{12}_[A-Za-z0-9_-]+$/);
    expect(parseApiKey(k.plain)).toEqual({ prefix: k.prefix, plain: k.plain });
    expect(parseApiKey('ssk_bad')).toBeNull();
    expect(parseApiKey(undefined)).toBeNull();
    expect(apiKeyMatches(k.plain, k.hash)).toBe(true);
    expect(apiKeyMatches(k.plain + 'x', k.hash)).toBe(false);
  });

  it('keeps only known scopes', () => {
    expect(
      parseScopes('["students.view","users.manage","grades.export"]'),
    ).toEqual(['students.view', 'grades.export']);
    expect(parseScopes(null)).toEqual([]);
  });

  it('limits a key to its budget per minute', () => {
    const t0 = new Date('2026-10-07T10:00:10Z');
    let w = takeRateToken(undefined, 2, t0);
    expect(w.allowed).toBe(true);
    w = takeRateToken(w.window, 2, t0);
    expect(w.allowed).toBe(true);
    w = takeRateToken(w.window, 2, t0);
    expect(w.allowed).toBe(false);
    const next = takeRateToken(w.window, 2, new Date('2026-10-07T10:01:00Z'));
    expect(next.allowed).toBe(true);
    expect(next.window.count).toBe(1);
  });
});

describe('export formats', () => {
  const book: ExportBook = {
    className: 'English 7',
    section: 'A',
    students: [
      {
        id: 's1',
        studentNumber: 'S1',
        firstName: 'Ana',
        lastName: 'Diaz, Jr',
        email: 'ana@x.org',
        sisId: null,
      },
      {
        id: 's2',
        studentNumber: 'S2',
        firstName: 'Ben',
        lastName: 'Lee',
        email: null,
        sisId: 'SIS-2',
      },
    ],
    assignments: [
      {
        id: 'a1',
        title: 'Essay "One"',
        maxPoints: 20,
        dueAt: new Date('2026-10-10T00:00:00Z'),
        description: '<p>Write</p>',
        isExtraCredit: false,
      },
      {
        id: 'a2',
        title: 'Quiz',
        maxPoints: 10,
        dueAt: null,
        description: null,
        isExtraCredit: true,
      },
    ],
    cell: (s, a) =>
      s === 's1' && a === 'a1'
        ? { score: 18, mark: null }
        : s === 's2' && a === 'a1'
          ? { score: null, mark: 'excused' }
          : { score: null, mark: 'missing' },
    overall: (s) => (s === 's1' ? 90 : null),
  };

  it('writes the Canvas gradebook import layout with a points row and EX for excused', () => {
    const lines = canvasGradebookCsv(book).split('\r\n');
    expect(lines[0]).toBe(
      'Student,ID,SIS User ID,SIS Login ID,Section,"Essay ""One"" (a1)",Quiz (a2)',
    );
    expect(lines[1]).toBe('    Points Possible,,,,,20,10');
    expect(lines[2]).toBe('"Diaz, Jr, Ana",s1,S1,ana@x.org,A,18,');
    expect(lines[3]).toBe('"Lee, Ben",s2,SIS-2,,A,EX,');
  });

  it('writes the Google Classroom grade sheet with Missing and Excused words', () => {
    const lines = googleClassroomCsv(book).split('\r\n');
    expect(lines[0]).toBe(
      'Last Name,First Name,Email,Overall Grade,"Essay ""One"" (20 points)",Quiz (10 points)',
    );
    expect(lines[1]).toBe('"Diaz, Jr",Ana,ana@x.org,90,18,Missing');
    expect(lines[2]).toBe('Lee,Ben,,,Excused,Missing');
  });

  it('builds a Common Cartridge manifest that names every item once and escapes titles', () => {
    const m = commonCartridgeManifest('English 7 <A>', [
      { id: 'a1', title: 'Essay "One"', html: '' },
      { id: 'a2', title: 'Quiz & more', html: '' },
    ]);
    expect(m).toContain('<schemaversion>1.3.0</schemaversion>');
    expect(m).toContain('English 7 &lt;A&gt;');
    expect(m).toContain('<title>Quiz &amp; more</title>');
    expect(m.match(/identifierref="RES_a1"/g)).toHaveLength(1);
    expect(m.match(/<resource identifier="RES_/g)).toHaveLength(2);
  });
});

describe('LTI 1.3 rules', () => {
  const now = new Date('2026-10-07T10:00:00Z');
  const sec = Math.floor(now.getTime() / 1000);
  const good = {
    iss: 'https://canvas.test',
    aud: 'client-1',
    sub: 'u-9',
    exp: sec + 300,
    iat: sec - 5,
    nonce: 'n1',
    email: 'Teacher@School.org',
    given_name: 'Pat',
    family_name: 'Ng',
    [`${LTI_CLAIM}message_type`]: 'LtiResourceLinkRequest',
    [`${LTI_CLAIM}version`]: '1.3.0',
    [`${LTI_CLAIM}deployment_id`]: 'dep-1',
    [`${LTI_CLAIM}roles`]: [
      'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor',
    ],
    [`${LTI_CLAIM}context`]: { id: 'c-1', title: 'Period 2' },
    [`${LTI_CLAIM}target_link_uri`]:
      'http://localhost:5000/api/v1/lti/launch?path=%2Fassignments',
  };
  const expected = {
    issuer: 'https://canvas.test',
    clientId: 'client-1',
    nonce: 'n1',
    deploymentId: 'dep-1',
  };

  it('accepts a correct launch and reads the person, roles and context', () => {
    const r = checkLaunchClaims(good, expected, now);
    expect(r.ok).toBe(true);
    expect(r.email).toBe('teacher@school.org');
    expect(r.name).toEqual({ given: 'Pat', family: 'Ng' });
    expect(r.context).toEqual({ id: 'c-1', title: 'Period 2' });
    expect(roleFromLtiRoles(r.roles)).toBe('TEACHER');
  });

  it('rejects the wrong issuer, audience, nonce, expiry, message type and deployment', () => {
    expect(checkLaunchClaims({ ...good, iss: 'x' }, expected, now).reason).toBe(
      'issuer',
    );
    expect(
      checkLaunchClaims({ ...good, aud: ['other'] }, expected, now).reason,
    ).toBe('audience');
    expect(
      checkLaunchClaims({ ...good, nonce: 'n2' }, expected, now).reason,
    ).toBe('nonce');
    expect(
      checkLaunchClaims({ ...good, exp: sec - 600 }, expected, now).reason,
    ).toBe('expired');
    expect(
      checkLaunchClaims(
        { ...good, [`${LTI_CLAIM}message_type`]: 'LtiSomethingElse' },
        expected,
        now,
      ).reason,
    ).toBe('message_type');
    expect(
      checkLaunchClaims(
        { ...good, [`${LTI_CLAIM}deployment_id`]: 'dep-2' },
        expected,
        now,
      ).reason,
    ).toBe('deployment_mismatch');
    expect(
      checkLaunchClaims(good, { ...expected, deploymentId: null }, now).ok,
    ).toBe(true);
  });

  it('maps roles both ways', () => {
    expect(
      roleFromLtiRoles([
        'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner',
      ]),
    ).toBe('STUDENT');
    expect(
      roleFromLtiRoles([
        'http://purl.imsglobal.org/vocab/lis/v2/membership#Administrator',
      ]),
    ).toBe('PRINCIPAL');
    expect(roleFromLtiRoles([])).toBe('STUDENT');
    expect(ltiRolesFor('TEACHER')).toEqual([
      'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor',
    ]);
    expect(ltiRolesFor('STUDENT')).toEqual([
      'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner',
    ]);
  });

  it('lands the launch on our own path only', () => {
    expect(
      launchPathFor(
        'http://localhost:5000/api/v1/lti/launch?path=%2Fassignments',
        'http://localhost:5000',
        undefined,
      ),
    ).toBe('/assignments');
    expect(
      launchPathFor(
        'https://evil.test/x?path=%2Fassignments',
        'http://localhost:5000',
        undefined,
      ),
    ).toBe('/dashboard');
    expect(
      launchPathFor(
        'http://localhost:5000/api/v1/lti/launch?path=//evil',
        'http://localhost:5000',
        undefined,
      ),
    ).toBe('/dashboard');
    expect(
      launchPathFor(undefined, 'http://localhost:5000', { path: '/tutor' }),
    ).toBe('/tutor');
    expect(
      launchPathFor(undefined, 'http://localhost:5000', { path: '//evil' }),
    ).toBe('/dashboard');
    expect(
      launchPathFor(undefined, 'http://localhost:5000', { path: '/a\\evil' }),
    ).toBe('/dashboard');
    expect(
      launchPathFor(undefined, 'http://localhost:5000', { path: 'https://x' }),
    ).toBe('/dashboard');
  });

  it('builds a platform id_token and a tool configuration', () => {
    const claims = platformLaunchClaims({
      issuer: 'http://localhost:5000',
      clientId: 'tool-1',
      deploymentId: 'd-1',
      nonce: 'n',
      user: {
        id: 'u1',
        email: 'a@b.c',
        firstName: 'A',
        lastName: 'B',
        role: 'STUDENT',
      },
      targetLinkUri: 'https://tool.test/launch',
      resourceLinkId: 'class-1',
      context: { id: 'class-1', title: 'Math 8' },
      custom: { term: 'Fall' },
      now,
    });
    expect(claims).toMatchObject({
      iss: 'http://localhost:5000',
      aud: 'tool-1',
      sub: 'u1',
      exp: sec + 300,
    });
    expect(claims[`${LTI_CLAIM}roles`]).toEqual([
      'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner',
    ]);
    expect(claims[`${LTI_CLAIM}context`]).toMatchObject({
      id: 'class-1',
      title: 'Math 8',
    });
    const cfg = toolConfiguration(
      'http://localhost:5000/',
      'http://localhost:3000',
      'Demo School',
    );
    expect(cfg.oidc_initiation_url).toBe(
      'http://localhost:5000/api/v1/lti/login',
    );
    expect(cfg.public_jwk_url).toBe('http://localhost:5000/api/v1/lti/jwks');
    const form = autoPostForm('https://tool.test/login', {
      iss: 'x',
      login_hint: 'a"b',
    });
    expect(form).toContain('action="https://tool.test/login"');
    expect(form).toContain('value="a&quot;b"');
  });
});

describe('LTI services (slice 30)', () => {
  it('reads the service URLs and the deep-linking settings a launch carries', () => {
    const claims = {
      [LTI_NRPS_CLAIM]: {
        context_memberships_url:
          'https://lms.test/api/lti/courses/1/names_and_roles',
        service_versions: ['2.0'],
      },
      [LTI_AGS_CLAIM]: {
        scope: ['https://purl.imsglobal.org/spec/lti-ags/scope/score'],
        lineitems: 'https://lms.test/api/lti/courses/1/line_items',
        lineitem: 'https://lms.test/api/lti/courses/1/line_items/7',
      },
      [`${LTI_DL_CLAIM}deep_linking_settings`]: {
        deep_link_return_url:
          'https://lms.test/courses/1/deep_linking_response',
        accept_types: ['ltiResourceLink'],
        data: 'opaque',
      },
    };
    expect(launchServices(claims)).toEqual({
      membershipsUrl: 'https://lms.test/api/lti/courses/1/names_and_roles',
      lineItemsUrl: 'https://lms.test/api/lti/courses/1/line_items',
      lineItemUrl: 'https://lms.test/api/lti/courses/1/line_items/7',
      scopes: ['https://purl.imsglobal.org/spec/lti-ags/scope/score'],
    });
    expect(
      launchServices({ [LTI_AGS_CLAIM]: { lineitem: 'javascript:alert(1)' } })
        .lineItemUrl,
    ).toBeNull();
    const sec = Math.floor(Date.now() / 1000);
    const base = {
      iss: 'https://lms.test',
      aud: 'c1',
      sub: 'u1',
      exp: sec + 60,
      iat: sec,
      nonce: 'n',
      [`${LTI_CLAIM}version`]: '1.3.0',
      [`${LTI_CLAIM}deployment_id`]: 'd1',
    };
    const dl = checkLaunchClaims(
      {
        ...base,
        [`${LTI_CLAIM}message_type`]: 'LtiDeepLinkingRequest',
        ...claims,
      },
      {
        issuer: 'https://lms.test',
        clientId: 'c1',
        nonce: 'n',
        deploymentId: null,
      },
      new Date(),
    );
    expect(dl.ok).toBe(true);
    expect(dl.messageType).toBe('LtiDeepLinkingRequest');
    expect(dl.deepLinking).toEqual({
      returnUrl: 'https://lms.test/courses/1/deep_linking_response',
      data: 'opaque',
      acceptTypes: ['ltiResourceLink'],
      acceptMultiple: true,
    });
    const noSettings = checkLaunchClaims(
      { ...base, [`${LTI_CLAIM}message_type`]: 'LtiDeepLinkingRequest' },
      {
        issuer: 'https://lms.test',
        clientId: 'c1',
        nonce: 'n',
        deploymentId: null,
      },
      new Date(),
    );
    expect(noSettings.ok).toBe(false);
    expect(noSettings.reason).toBe('deep_linking_settings');
  });

  it('turns a Names and Roles container into enrollable members and follows pagination', () => {
    const roster = membersToRoster([
      {
        user_id: 't1',
        roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor'],
        email: 'T@School.test',
        name: 'Taylor Brooks',
      },
      {
        user_id: 's1',
        roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
        given_name: 'Lee',
        family_name: 'Learner',
      },
      {
        user_id: 's2',
        roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
        status: 'Inactive',
      },
      {
        user_id: 'm1',
        roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Mentor'],
      },
      { user_id: '' },
    ]);
    expect(roster.map((m) => [m.subject, m.isTeacher, m.enrollable])).toEqual([
      ['t1', true, true],
      ['s1', false, true],
      ['s2', false, false],
      ['m1', false, false],
    ]);
    expect(roster[0].email).toBe('t@school.test');
    expect(roster[0].name).toEqual({ given: 'Taylor', family: 'Brooks' });
    expect(
      nextPageFrom(
        '<https://lms.test/members?page=2>; rel="next", <https://lms.test/members?page=1>; rel="prev"',
      ),
    ).toBe('https://lms.test/members?page=2');
    expect(
      nextPageFrom('<https://lms.test/members?page=1>; rel="prev"'),
    ).toBeNull();
    expect(nextPageFrom(null)).toBeNull();
  });

  it('builds the token assertion, the score call and the deep-linking response', () => {
    const now = new Date('2026-10-16T12:00:00Z');
    expect(
      clientAssertionClaims('client-1', 'https://lms.test/token', now, 'j1'),
    ).toMatchObject({
      iss: 'client-1',
      sub: 'client-1',
      aud: 'https://lms.test/token',
      jti: 'j1',
      exp: Math.floor(now.getTime() / 1000) + 300,
    });
    expect(scoreUrl('https://lms.test/line_items/7')).toBe(
      'https://lms.test/line_items/7/scores',
    );
    expect(scoreUrl('https://lms.test/line_items/7?type_id=1')).toBe(
      'https://lms.test/line_items/7/scores?type_id=1',
    );
    expect(scorePayload('s1', 8.5, 10, now)).toEqual({
      userId: 's1',
      scoreGiven: 8.5,
      scoreMaximum: 10,
      activityProgress: 'Completed',
      gradingProgress: 'FullyGraded',
      timestamp: '2026-10-16T12:00:00.000Z',
    });
    const item = deepLinkContentItem({
      id: 'a1',
      title: 'Essay',
      maxPoints: 20,
      launchUrl: 'http://localhost:5000/api/v1/lti/launch',
      path: '/assignments/a1',
    });
    expect(item).toMatchObject({
      type: 'ltiResourceLink',
      url: 'http://localhost:5000/api/v1/lti/launch',
      custom: {
        smartschool_assignment_id: 'a1',
        smartschool_path: '/assignments/a1',
      },
      lineItem: { scoreMaximum: 20, resourceId: 'a1' },
    });
    const claims = deepLinkingResponseClaims({
      clientId: 'client-1',
      issuer: 'https://lms.test',
      deploymentId: 'd1',
      data: 'opaque',
      items: [item],
      now,
    });
    expect(claims).toMatchObject({
      iss: 'client-1',
      aud: 'https://lms.test',
      [`${LTI_CLAIM}message_type`]: 'LtiDeepLinkingResponse',
      [`${LTI_CLAIM}deployment_id`]: 'd1',
      [`${LTI_DL_CLAIM}data`]: 'opaque',
    });
    expect((claims[`${LTI_DL_CLAIM}content_items`] as unknown[]).length).toBe(
      1,
    );
  });
});

describe('LTI services as the platform (slice 30)', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  it('issues and checks service tokens by tool, scope and expiry', () => {
    const token = signServiceToken('secret', {
      tool: 't1',
      scopes: [LTI_SCOPE.score],
      exp: now.getTime() + 1000,
    });
    expect(verifyServiceToken('secret', token, now.getTime())).toEqual({
      tool: 't1',
      scopes: [LTI_SCOPE.score],
      exp: now.getTime() + 1000,
    });
    expect(verifyServiceToken('other', token, now.getTime())).toBeNull();
    expect(
      verifyServiceToken('secret', token, now.getTime() + 2000),
    ).toBeNull();
    expect(verifyServiceToken('secret', token + 'x', now.getTime())).toBeNull();
    expect(verifyServiceToken('secret', 'nonsense', now.getTime())).toBeNull();
  });

  it('describes line items, results and memberships the way the services do', () => {
    expect(
      lineItemView('http://api/lineitems', {
        id: 'li1',
        label: 'Quiz',
        scoreMaximum: '10.00',
        resourceId: 'r1',
        resourceLinkId: null,
        tag: null,
      }),
    ).toEqual({
      id: 'http://api/lineitems/li1',
      label: 'Quiz',
      scoreMaximum: 10,
      resourceId: 'r1',
    });
    expect(
      resultView('http://api/lineitems/li1', {
        id: 's1',
        userId: 'u1',
        scoreGiven: '8.50',
        scoreMaximum: '10',
        comment: null,
        timestamp: now,
      }),
    ).toEqual({
      id: 'http://api/lineitems/li1/results/s1',
      scoreOf: 'http://api/lineitems/li1',
      userId: 'u1',
      resultScore: 8.5,
      resultMaximum: 10,
      timestamp: '2026-10-16T12:00:00.000Z',
    });
    const m = membershipsView(
      'http://api/m',
      { id: 'c1', title: 'Math 8', label: 'A' },
      [
        {
          userId: 'u1',
          email: 'a@x',
          firstName: 'Ana',
          lastName: 'Roster',
          roles: ['r'],
        },
      ],
    );
    expect(m).toMatchObject({ id: 'http://api/m', context: { id: 'c1' } });
    expect((m.members as Array<Record<string, unknown>>)[0]).toMatchObject({
      status: 'Active',
      user_id: 'u1',
      name: 'Ana Roster',
    });
    expect(scoreToPercentage(8.5, 10)).toBe(85);
    expect(scoreToPercentage(1, 3)).toBe(33.33);
    expect(scoreToPercentage(5, 0)).toBe(0);
  });

  it('adds the service and deep-linking claims to a platform launch', () => {
    const base = {
      issuer: 'http://api',
      clientId: 'tool-1',
      deploymentId: 'dep',
      nonce: 'n',
      user: {
        id: 'u1',
        email: 'e',
        firstName: 'A',
        lastName: 'B',
        role: 'TEACHER' as const,
      },
      targetLinkUri: 'https://tool.test/launch',
      resourceLinkId: 'rl',
      context: { id: 'c1', title: 'Math' },
      custom: {},
      now,
    };
    const launch = platformLaunchClaims({
      ...base,
      services: {
        membershipsUrl: 'http://api/nrps',
        lineItemsUrl: 'http://api/ags',
        lineItemUrl: 'http://api/ags/li1',
      },
    });
    expect(launch[LTI_NRPS_CLAIM]).toEqual({
      context_memberships_url: 'http://api/nrps',
      service_versions: ['2.0'],
    });
    expect(launch[LTI_AGS_CLAIM]).toMatchObject({
      lineitems: 'http://api/ags',
      lineitem: 'http://api/ags/li1',
    });
    expect(launch[`${LTI_CLAIM}message_type`]).toBe('LtiResourceLinkRequest');
    const dl = platformLaunchClaims({
      ...base,
      deepLinking: { returnUrl: 'http://api/return', data: 'state' },
    });
    expect(dl[`${LTI_CLAIM}message_type`]).toBe('LtiDeepLinkingRequest');
    expect(dl[`${LTI_DL_CLAIM}deep_linking_settings`]).toMatchObject({
      deep_link_return_url: 'http://api/return',
      accept_types: ['ltiResourceLink'],
      data: 'state',
    });
    expect(dl[`${LTI_CLAIM}resource_link`]).toBeUndefined();
  });

  it('checks a deep-linking response and keeps only usable resource links', () => {
    const sec = Math.floor(now.getTime() / 1000);
    const good = {
      iss: 'tool-1',
      aud: 'http://api',
      exp: sec + 60,
      iat: sec,
      [`${LTI_CLAIM}message_type`]: 'LtiDeepLinkingResponse',
      [`${LTI_CLAIM}version`]: '1.3.0',
      [`${LTI_CLAIM}deployment_id`]: 'dep',
      [`${LTI_DL_CLAIM}data`]: 'state',
      [`${LTI_DL_CLAIM}content_items`]: [
        {
          type: 'ltiResourceLink',
          title: 'Lab 3',
          url: 'https://tool.test/labs/3',
          custom: { lab: '3', bad: 5 },
          lineItem: { scoreMaximum: 20, label: 'Lab 3' },
        },
        { type: 'ltiResourceLink', url: 'javascript:alert(1)' },
        { type: 'link', url: 'https://tool.test/x' },
        { type: 'ltiResourceLink', url: 'https://tool.test/ungraded' },
      ],
    };
    const expected = {
      clientId: 'tool-1',
      issuer: 'http://api',
      deploymentId: 'dep',
      now,
    };
    const ok = checkDeepLinkingResponse(good, expected);
    expect(ok.ok).toBe(true);
    expect(ok.data).toBe('state');
    expect(ok.items).toEqual([
      {
        title: 'Lab 3',
        url: 'https://tool.test/labs/3',
        custom: { lab: '3' },
        lineItem: { scoreMaximum: 20, label: 'Lab 3' },
      },
      {
        title: 'Tool content',
        url: 'https://tool.test/ungraded',
        custom: null,
        lineItem: null,
      },
    ]);
    expect(
      checkDeepLinkingResponse({ ...good, iss: 'other' }, expected).reason,
    ).toBe('issuer');
    expect(
      checkDeepLinkingResponse(
        { ...good, [`${LTI_CLAIM}deployment_id`]: 'x' },
        expected,
      ).reason,
    ).toBe('deployment');
    expect(
      checkDeepLinkingResponse({ ...good, exp: sec - 600 }, expected).reason,
    ).toBe('expired');
  });
});
