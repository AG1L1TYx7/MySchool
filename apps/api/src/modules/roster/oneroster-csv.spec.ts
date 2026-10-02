import {
  bundleFromZip,
  missingFiles,
  snapshotFromBundle,
} from './oneroster-csv';
import { restrictToSchool } from './oneroster-api';
import { normalizeGrade, roleFrom, splitList } from './roster-model';
import { sampleZip } from '../../../test/fixtures/oneroster-sample';

describe('OneRoster CSV', () => {
  it('reads a zipped bundle into a snapshot, ignoring roles we do not roster', () => {
    const snap = snapshotFromBundle(bundleFromZip(sampleZip()));
    expect(snap.schools).toEqual([
      { externalId: 'org1', name: 'Lincoln Middle School' },
    ]);
    expect(snap.terms.map((t) => `${t.type}:${t.title}`)).toEqual([
      'schoolYear:2026-2027',
      'semester:Fall 2026',
    ]);
    expect(snap.users.map((u) => `${u.role}:${u.externalId}`)).toEqual([
      'teacher:t1',
      'student:s1',
      'student:s2',
      'parent:p1',
      'staff:x1',
    ]);
    const s1 = snap.users.find((u) => u.externalId === 's1');
    expect(s1).toMatchObject({
      email: 'avery.smith@students.example.org',
      identifier: 'S2001',
      grade: '7',
      dateOfBirth: '2013-04-02',
      schoolExternalIds: ['org1'],
    });
    expect(
      snap.users.find((u) => u.externalId === 'p1')?.agentExternalIds,
    ).toEqual(['s1', 's2']);
    expect(snap.courses[0]).toMatchObject({
      externalId: 'c1',
      courseCode: 'MATH7',
      subject: 'Mathematics',
      grade: '7',
    });
    expect(snap.classes[0]).toMatchObject({
      externalId: 'k1',
      courseExternalId: 'c1',
      termExternalIds: ['fall26'],
      period: '3',
      classCode: 'MATH7-3',
    });
    expect(
      snap.enrollments.map(
        (e) => `${e.role}:${e.userExternalId}${e.primary ? '*' : ''}`,
      ),
    ).toEqual(['teacher:t1*', 'student:s1', 'student:s2']);
  });

  it('names missing required files', () => {
    expect(missingFiles({ 'users.csv': 'x' })).toEqual([
      'classes.csv',
      'enrollments.csv',
    ]);
    expect(() => snapshotFromBundle({})).toThrow(/missing users.csv/);
  });

  it('maps roles and grades conservatively', () => {
    expect(roleFrom('Guardian')).toBe('parent');
    expect(roleFrom('aide')).toBe('staff');
    expect(roleFrom('administrator')).toBe('administrator');
    expect(roleFrom('alien')).toBe('ignored');
    expect(normalizeGrade('Grade 07')).toBe('7');
    expect(normalizeGrade('KG')).toBe('K');
    expect(normalizeGrade('')).toBeNull();
    expect(splitList(' a, b ,,c')).toEqual(['a', 'b', 'c']);
  });

  it('restricts a district snapshot to one school', () => {
    const snap = snapshotFromBundle(bundleFromZip(sampleZip()));
    snap.classes.push({
      externalId: 'k9',
      title: 'Other school class',
      classCode: null,
      courseExternalId: 'c1',
      schoolExternalId: 'org9',
      termExternalIds: [],
      period: null,
      grade: null,
      active: true,
    });
    snap.enrollments.push({
      externalId: 'e9',
      classExternalId: 'k9',
      userExternalId: 's1',
      role: 'student',
      primary: false,
      active: true,
    });
    restrictToSchool(snap, 'org1');
    expect(snap.classes.map((c) => c.externalId)).toEqual(['k1']);
    expect(snap.enrollments.map((e) => e.externalId)).toEqual([
      'e1',
      'e2',
      'e3',
    ]);
  });
});
