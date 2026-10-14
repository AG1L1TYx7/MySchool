import { unzipSync, type UnzipFileInfo } from 'fflate';
import { parseCsv } from '../../common/utils/csv';
import {
  emptySnapshot,
  isActiveStatus,
  normalizeEmail,
  normalizeGrade,
  roleFrom,
  splitList,
  type RosterSnapshot,
} from './roster-model';

/** UTF-8 byte-order mark some exporters prepend; stripped before parsing. */
const BOM = String.fromCharCode(0xfeff);

/**
 * OneRoster 1.1 CSV bundle -> snapshot. Accepts the zip a SIS exports or the individual files.
 * Required: users.csv, classes.csv, enrollments.csv. Optional: orgs.csv, academicSessions.csv, courses.csv,
 * demographics.csv, manifest.csv. Column order does not matter; headers are matched by name.
 */
export const REQUIRED_FILES = [
  'users.csv',
  'classes.csv',
  'enrollments.csv',
] as const;

export interface CsvBundle {
  [fileName: string]: string;
}

/**
 * How much a OneRoster zip may inflate to (docs/21 F09): only the CSV files are opened, none larger than
 * `fileMaxBytes`, and the whole bundle no larger than `totalMaxBytes`. The limits are generous for a
 * large district's users.csv yet far below what a crafted archive could expand to.
 */
export const ZIP_LIMITS = {
  fileMaxBytes: 200 * 1024 * 1024,
  totalMaxBytes: 400 * 1024 * 1024,
  maxFiles: 24,
} as const;

/** fflate's entry filter: which zip entries are inflated at all, counting the declared sizes as it goes. */
export function zipEntryFilter(
  limits: {
    fileMaxBytes: number;
    totalMaxBytes: number;
    maxFiles: number;
  } = ZIP_LIMITS,
) {
  let total = 0;
  let count = 0;
  return (file: Pick<UnzipFileInfo, 'name' | 'originalSize'>): boolean => {
    const name = file.name.split('/').pop()?.toLowerCase() ?? '';
    if (!name.endsWith('.csv') || name.startsWith('.')) return false;
    if (file.originalSize > limits.fileMaxBytes) return false;
    if (total + file.originalSize > limits.totalMaxBytes) return false;
    if (count + 1 > limits.maxFiles) return false;
    total += file.originalSize;
    count += 1;
    return true;
  };
}

export function bundleFromZip(zip: Uint8Array): CsvBundle {
  const files = unzipSync(zip, { filter: zipEntryFilter() });
  const bundle: CsvBundle = {};
  for (const [path, bytes] of Object.entries(files)) {
    const name = path.split('/').pop()?.toLowerCase() ?? '';
    if (name.endsWith('.csv'))
      bundle[name] = new TextDecoder('utf-8').decode(bytes).replace(BOM, '');
  }
  return bundle;
}

function table(bundle: CsvBundle, file: string): Array<Record<string, string>> {
  const text = bundle[file];
  if (!text) return [];
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim().replace(BOM, ''));
  return rows
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) =>
      Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])),
    );
}

export function missingFiles(bundle: CsvBundle): string[] {
  return REQUIRED_FILES.filter((f) => !bundle[f]);
}

export function snapshotFromBundle(bundle: CsvBundle): RosterSnapshot {
  const missing = missingFiles(bundle);
  if (missing.length)
    throw new Error(`OneRoster bundle is missing ${missing.join(', ')}`);
  const snap = emptySnapshot();

  for (const r of table(bundle, 'orgs.csv')) {
    if ((r.type ?? '').toLowerCase() === 'school' || !r.type)
      snap.schools.push({ externalId: r.sourcedId, name: r.name });
  }
  for (const r of table(bundle, 'academicsessions.csv').concat(
    table(bundle, 'academicSessions.csv'),
  )) {
    const type = (r.type ?? '').toLowerCase();
    snap.terms.push({
      externalId: r.sourcedId,
      title: r.title,
      type:
        type === 'schoolyear'
          ? 'schoolYear'
          : type === 'term'
            ? 'term'
            : type === 'semester'
              ? 'semester'
              : type === 'gradingperiod'
                ? 'gradingPeriod'
                : 'other',
      startDate: r.startDate || null,
      endDate: r.endDate || null,
      schoolYear: r.schoolYear || null,
    });
  }
  const birthdays = new Map<string, string>();
  for (const r of table(bundle, 'demographics.csv'))
    if (r.birthDate) birthdays.set(r.sourcedId, r.birthDate);
  for (const r of table(bundle, 'users.csv')) {
    const role = roleFrom(r.role);
    if (role === 'ignored') continue;
    snap.users.push({
      externalId: r.sourcedId,
      role,
      active:
        isActiveStatus(r.status) &&
        (r.enabledUser ?? 'true').toLowerCase() !== 'false',
      email: normalizeEmail(r.email),
      username: r.username || null,
      identifier: r.identifier || null,
      firstName: r.givenName || '',
      lastName: r.familyName || '',
      grade: normalizeGrade(splitList(r.grades)[0] ?? null),
      dateOfBirth: birthdays.get(r.sourcedId) ?? null,
      schoolExternalIds: splitList(r.orgSourcedIds),
      agentExternalIds: splitList(r.agentSourcedIds),
    });
  }
  for (const r of table(bundle, 'courses.csv')) {
    snap.courses.push({
      externalId: r.sourcedId,
      title: r.title,
      courseCode: r.courseCode || null,
      subject: splitList(r.subjects)[0] ?? null,
      grade: normalizeGrade(splitList(r.grades)[0] ?? null),
      schoolExternalId: r.orgSourcedId || null,
    });
  }
  for (const r of table(bundle, 'classes.csv')) {
    snap.classes.push({
      externalId: r.sourcedId,
      title: r.title,
      classCode: r.classCode || null,
      courseExternalId: r.courseSourcedId || null,
      schoolExternalId: r.schoolSourcedId || null,
      termExternalIds: splitList(r.termSourcedIds),
      period: splitList(r.periods)[0] ?? null,
      grade: normalizeGrade(splitList(r.grades)[0] ?? null),
      active: isActiveStatus(r.status),
    });
  }
  for (const r of table(bundle, 'enrollments.csv')) {
    const role = roleFrom(r.role);
    snap.enrollments.push({
      externalId: r.sourcedId,
      classExternalId: r.classSourcedId,
      userExternalId: r.userSourcedId,
      role:
        role === 'student'
          ? 'student'
          : role === 'teacher'
            ? 'teacher'
            : 'ignored',
      primary: (r.primary ?? '').toLowerCase() === 'true',
      active: isActiveStatus(r.status),
    });
  }
  return snap;
}
