/**
 * Mobile rules (docs/02 section 17): compact shapes and the sync cursor for phones on slow or absent networks.
 * Pure; the service reads the database.
 */

export interface CompactAssignment {
  id: string;
  title: string;
  classId: string;
  className: string;
  type: string;
  dueAt: string | null;
  maxPoints: number;
  status: string;
  /** For students and families: where this piece of work stands. */
  state: 'graded' | 'submitted' | 'missing' | 'due' | 'open';
  percentage: number | null;
  bucket: 'overdue' | 'today' | 'tomorrow' | 'this_week' | 'later' | 'none';
}

export interface AssignmentLike {
  id: string;
  title: string;
  classId: string;
  className: string;
  type: string;
  dueAt: Date | null;
  maxPoints: number;
  status: string;
  mySubmission?: { status?: string } | null;
  myGrade?: { percentage: number } | null;
}

const DAY = 86_400_000;

function startOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Which list a piece of work belongs in on a phone: overdue, today, tomorrow, this week, later. */
export function dueBucket(
  dueAt: Date | null,
  now = new Date(),
): CompactAssignment['bucket'] {
  if (!dueAt) return 'none';
  const today = startOfDay(now);
  const due = startOfDay(dueAt);
  if (dueAt.getTime() < now.getTime() && due < today) return 'overdue';
  if (due === today)
    return dueAt.getTime() < now.getTime() ? 'overdue' : 'today';
  if (due === today + DAY) return 'tomorrow';
  if (due < today + 7 * DAY) return 'this_week';
  return 'later';
}

export function workState(
  a: AssignmentLike,
  now = new Date(),
): CompactAssignment['state'] {
  if (a.myGrade) return 'graded';
  if (a.mySubmission) return 'submitted';
  if (a.dueAt && a.dueAt.getTime() < now.getTime()) return 'missing';
  return a.dueAt ? 'due' : 'open';
}

export function compactAssignment(
  a: AssignmentLike,
  now = new Date(),
): CompactAssignment {
  return {
    id: a.id,
    title: a.title,
    classId: a.classId,
    className: a.className,
    type: a.type,
    dueAt: a.dueAt ? a.dueAt.toISOString() : null,
    maxPoints: a.maxPoints,
    status: a.status,
    state: workState(a, now),
    percentage: a.myGrade ? a.myGrade.percentage : null,
    bucket: dueBucket(a.dueAt, now),
  };
}

/** Sort for a phone: overdue first, then by due date, undated last. */
export function sortForPhone<
  T extends { dueAt: string | null; bucket: CompactAssignment['bucket'] },
>(items: T[]): T[] {
  const rank: Record<CompactAssignment['bucket'], number> = {
    overdue: 0,
    today: 1,
    tomorrow: 2,
    this_week: 3,
    later: 4,
    none: 5,
  };
  return [...items].sort(
    (a, b) =>
      rank[a.bucket] - rank[b.bucket] ||
      (a.dueAt ?? '').localeCompare(b.dueAt ?? ''),
  );
}

/** The sync cursor is an ISO time; anything unparsable or in the future means "everything". */
export function parseSince(
  since: string | undefined,
  now = new Date(),
): Date | null {
  if (!since) return null;
  const d = new Date(since);
  if (Number.isNaN(d.getTime()) || d.getTime() > now.getTime()) return null;
  return d;
}

/** The next cursor sits a little before now so a write that committed during the sync is not missed. */
export function nextCursor(now = new Date()): string {
  return new Date(now.getTime() - 2000).toISOString();
}

/** Keeps the latest version of each record by id, the server copy winning ties. */
export function mergeById<T extends { id: string; updatedAt: string }>(
  local: T[],
  server: T[],
): T[] {
  const map = new Map<string, T>();
  for (const l of local) map.set(l.id, l);
  for (const s of server) {
    const have = map.get(s.id);
    if (!have || have.updatedAt <= s.updatedAt) map.set(s.id, s);
  }
  return [...map.values()];
}

/** Client ids make offline replays safe: a message with a known id is returned, not stored twice. */
export function isClientMessageId(id: string | undefined): id is string {
  return (
    !!id &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  );
}
