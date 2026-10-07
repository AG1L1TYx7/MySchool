import {
  aiAllowedForSchool,
  averageDailyAttendance,
  districtTotals,
  domainVerification,
  featureDisabled,
  isValidDomain,
  isValidSlug,
  parseBranding,
  parsePolicies,
  slugify,
  tenantFromHost,
} from './tenant-rules';

describe('tenant rules', () => {
  it('parses policies with defaults and drops junk', () => {
    expect(parsePolicies(null)).toEqual({
      aiEnabled: true,
      aiDisabledSchools: [],
      studentMessagingAllowed: true,
      disabledFeatures: [],
      retention: {},
    });
    const p = parsePolicies(
      '{"aiEnabled":false,"aiDisabledSchools":["01a0f4ba-2f41-7bb3-a7f4-28d3309e135b","nope"],"disabledFeatures":["ai.tutor.chat","BAD CODE"],"retention":{"aiConversations":90,"auditLogs":"x"},"studentMessagingAllowed":false}',
    );
    expect(p.aiEnabled).toBe(false);
    expect(p.aiDisabledSchools).toEqual([
      '01a0f4ba-2f41-7bb3-a7f4-28d3309e135b',
    ]);
    expect(p.disabledFeatures).toEqual(['ai.tutor.chat']);
    expect(p.retention).toEqual({ aiConversations: 90 });
    expect(p.studentMessagingAllowed).toBe(false);
    expect(aiAllowedForSchool(p, '01a0f4ba-2f41-7bb3-a7f4-28d3309e135b')).toBe(
      false,
    );
    expect(
      aiAllowedForSchool(
        { ...p, aiEnabled: true },
        '01a0f4ba-2f41-7bb3-a7f4-28d3309e135b',
      ),
    ).toBe(false);
    expect(aiAllowedForSchool({ ...p, aiEnabled: true }, 'other')).toBe(true);
    expect(featureDisabled(p, 'ai.tutor.chat')).toBe(true);
    expect(featureDisabled(p, 'grades.view.own')).toBe(false);
  });

  it('parses branding safely', () => {
    expect(
      parseBranding(
        '{"displayName":" Lakeside USD ","primaryColor":"#1E40AF","logoUrl":"javascript:alert(1)","supportEmail":"help@lakeside.example"}',
      ),
    ).toEqual({
      displayName: 'Lakeside USD',
      primaryColor: '#1e40af',
      logoUrl: null,
      supportEmail: 'help@lakeside.example',
    });
    expect(
      parseBranding(
        '{"primaryColor":"blue","logoUrl":"https://cdn.example/logo.png"}',
      ).primaryColor,
    ).toBeNull();
    expect(
      parseBranding('{"logoUrl":"https://cdn.example/logo.png"}').logoUrl,
    ).toBe('https://cdn.example/logo.png');
  });

  it('makes DNS-safe slugs and validates slugs and domains', () => {
    expect(slugify('Lakeside Unified School District!')).toBe(
      'lakeside-unified-school-district',
    );
    expect(isValidSlug('lakeside-usd')).toBe(true);
    expect(isValidSlug('www')).toBe(false);
    expect(isValidSlug('a--b')).toBe(false);
    expect(isValidSlug('default')).toBe(true);
    expect(isValidDomain('portal.lakeside.k12.ca.us')).toBe(true);
    expect(isValidDomain('not a domain')).toBe(false);
  });

  it('resolves the tenant from the host header', () => {
    expect(
      tenantFromHost('lakeside.smartschool.app:3000', 'smartschool.app'),
    ).toEqual({ slug: 'lakeside' });
    expect(tenantFromHost('smartschool.app', 'smartschool.app')).toEqual({
      default: true,
    });
    expect(tenantFromHost('localhost:3000', 'smartschool.app')).toEqual({
      default: true,
    });
    expect(
      tenantFromHost('portal.lakeside.k12.ca.us', 'smartschool.app'),
    ).toEqual({ customDomain: 'portal.lakeside.k12.ca.us' });
    expect(tenantFromHost('a.b.smartschool.app', 'smartschool.app')).toEqual({
      default: true,
    });
    const v = domainVerification('t1', 'portal.lakeside.k12.ca.us', 'secret');
    expect(v.name).toBe('_smartschool.portal.lakeside.k12.ca.us');
    expect(v.value).toMatch(/^smartschool-verify=[0-9a-f]{32}$/);
    expect(
      domainVerification('t1', 'portal.lakeside.k12.ca.us', 'other').value,
    ).not.toBe(v.value);
  });

  it('totals the district with student-weighted rates and computes ADA', () => {
    const t = districtTotals([
      {
        organizationId: 'a',
        name: 'A',
        students: 100,
        staff: 10,
        attendanceRate30: 90,
        presentToday: 95,
        missingItems: 5,
        failing: 2,
        gradebookCompleteness: 80,
        aiConversations7: 7,
        openIncidents: 1,
      },
      {
        organizationId: 'b',
        name: 'B',
        students: 300,
        staff: 20,
        attendanceRate30: 94,
        presentToday: null,
        missingItems: 15,
        failing: 6,
        gradebookCompleteness: 60,
        aiConversations7: 3,
        openIncidents: 0,
      },
    ]);
    expect(t).toMatchObject({
      schools: 2,
      students: 400,
      staff: 30,
      attendanceRate30: 93,
      presentToday: 95,
      missingItems: 20,
      failing: 8,
      gradebookCompleteness: 65,
      aiConversations7: 10,
      openIncidents: 1,
    });
    expect(averageDailyAttendance([])).toBeNull();
    expect(
      averageDailyAttendance([
        { status: 'PRESENT' },
        { status: 'ABSENT' },
        { status: 'TARDY' },
        { status: 'EXCUSED' },
      ]),
    ).toBe(0.5);
  });
});
