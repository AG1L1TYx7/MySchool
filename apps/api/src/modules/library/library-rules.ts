import type { Role } from '../../generated/prisma/client';

/**
 * Library (slice 22, docs/02 sections 10 and 30): who may see, change, publish and review an item,
 * when a change is a new version, what text is embedded for semantic search, and how results are merged.
 */

export const LIBRARY_KINDS = [
  'h5p',
  'document',
  'link',
  'lesson_plan',
] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

export const VISIBILITIES = [
  'private',
  'school',
  'district',
  'public',
] as const;
export type Visibility = (typeof VISIBILITIES)[number];
const VISIBILITY_RANK: Record<Visibility, number> = {
  private: 0,
  school: 1,
  district: 2,
  public: 3,
};

export const ITEM_STATUSES = [
  'draft',
  'pending_review',
  'published',
  'rejected',
  'archived',
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const FLAG_REASONS = [
  'inaccurate',
  'inappropriate',
  'copyright',
  'broken',
  'other',
] as const;

export interface Viewer {
  id: string;
  role: Role;
  organizationId: string | null;
  tenantId: string | null;
  tenantOrganizationIds?: string[];
}

export interface VisibleItem {
  createdById: string | null;
  organizationId: string;
  tenantId: string | null;
  visibility: string;
  status: string;
  deletedAt?: Date | null;
}

const isDistrict = (v: Viewer) =>
  v.role === 'SUPER_ADMIN' || v.role === 'SUPERINTENDENT';
const isAdmin = (v: Viewer) => isDistrict(v) || v.role === 'PRINCIPAL';
const isStaff = (v: Viewer) =>
  isAdmin(v) ||
  v.role === 'TEACHER' ||
  v.role === 'COUNSELOR' ||
  v.role === 'ASSISTANT';

const sameTenant = (v: Viewer, item: VisibleItem) =>
  v.role === 'SUPER_ADMIN' ||
  (v.tenantId !== null && v.tenantId === item.tenantId);
const sameSchool = (v: Viewer, item: VisibleItem) =>
  v.organizationId === item.organizationId ||
  (v.role === 'SUPERINTENDENT' &&
    (v.tenantOrganizationIds ?? []).includes(item.organizationId)) ||
  v.role === 'SUPER_ADMIN';

/** May this person open the item? Creators and the school's administrators always can; others by visibility once published. */
export function canSee(item: VisibleItem, viewer: Viewer): boolean {
  if (item.deletedAt) return false;
  if (item.createdById === viewer.id) return true;
  if (isAdmin(viewer) && sameSchool(viewer, item)) return true;
  if (item.status !== 'published') return false;
  switch (item.visibility as Visibility) {
    case 'public':
      return true;
    case 'district':
      return sameTenant(viewer, item);
    case 'school':
      return sameSchool(viewer, item);
    default:
      return false;
  }
}

/** Creators change their own items; administrators of the school and district roles may change any. */
export function canEdit(item: VisibleItem, viewer: Viewer): boolean {
  if (item.deletedAt) return false;
  if (item.createdById === viewer.id && isStaff(viewer)) return true;
  return isAdmin(viewer) && sameSchool(viewer, item);
}

/** Who approves what: school-wide items publish at once; district items need a school administrator; public items a district role. */
export function requiresReview(visibility: string, viewer: Viewer): boolean {
  if (visibility === 'public') return !isDistrict(viewer);
  if (visibility === 'district') return !isAdmin(viewer);
  return false;
}

export function canReview(item: VisibleItem, viewer: Viewer): boolean {
  if (item.visibility === 'public')
    return isDistrict(viewer) && sameTenant(viewer, item);
  return isAdmin(viewer) && sameSchool(viewer, item);
}

/** Lowering a published item's reach never needs review; raising it to district or public may. */
export function statusAfterVisibilityChange(
  current: { status: string; visibility: string },
  next: string,
  viewer: Viewer,
): ItemStatus {
  if (current.status !== 'published') return current.status as ItemStatus;
  if (
    VISIBILITY_RANK[next as Visibility] <=
    VISIBILITY_RANK[current.visibility as Visibility]
  )
    return 'published';
  return requiresReview(next, viewer) ? 'pending_review' : 'published';
}

/** Fields whose change is a new version (metadata-only edits such as keywords are not). */
export const VERSIONED_FIELDS = [
  'title',
  'description',
  'topics',
  'standards',
  'h5pContentId',
  'fileId',
  'url',
  'lessonPlanId',
  'parameters',
] as const;

export function isNewVersion(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  return VERSIONED_FIELDS.some(
    (f) =>
      f in after &&
      after[f] !== undefined &&
      JSON.stringify(after[f] ?? null) !== JSON.stringify(before[f] ?? null),
  );
}

export function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === 'string')
          .map((x) => x.trim())
          .filter(Boolean)
      : [];
  } catch {
    return raw
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  }
}

/** The text that stands for an item in the vector index. */
export function embeddingText(item: {
  title: string;
  description: string | null;
  subject: string | null;
  gradeLevel: string | null;
  topics: string | null;
  standards: string | null;
  keywords: string | null;
  kind: string;
}): string {
  const parts = [
    item.title,
    item.description ?? '',
    item.subject ? `Subject: ${item.subject}` : '',
    item.gradeLevel ? `Grade ${item.gradeLevel}` : '',
    parseList(item.topics).length
      ? `Topics: ${parseList(item.topics).join(', ')}`
      : '',
    parseList(item.standards).length
      ? `Standards: ${parseList(item.standards).join(', ')}`
      : '',
    item.keywords ?? '',
    `Kind: ${item.kind}`,
  ];
  return parts.filter(Boolean).join('\n');
}

export function averageRating(sum: number, count: number): number | null {
  return count > 0 ? Math.round((sum / count) * 10) / 10 : null;
}

/** Index namespaces: the district's catalogue, and a shared one for public items. */
export const libraryNamespace = (tenantId: string | null) =>
  `library:${tenantId ?? 'default'}`;
export const PUBLIC_NAMESPACE = 'library:public';
export const docIdFor = (itemId: string, scope: 'tenant' | 'public') =>
  scope === 'public' ? `libpub:${itemId}` : `lib:${itemId}`;
export const itemIdFromDocId = (docId: string): string | null => {
  const m = /^lib(?:pub)?:(.+)$/.exec(docId);
  return m ? m[1] : null;
};

/** Semantic hits and keyword matches merged: semantic score first, then keyword-only rows in their own order. */
export function mergeSearch<T extends { id: string }>(
  semantic: Array<{ itemId: string; score: number }>,
  keyword: T[],
  byId: Map<string, T>,
): Array<T & { score: number | null }> {
  const seen = new Set<string>();
  const out: Array<T & { score: number | null }> = [];
  for (const hit of [...semantic].sort((a, b) => b.score - a.score)) {
    const item = byId.get(hit.itemId);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push({ ...item, score: hit.score });
  }
  for (const item of keyword) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push({ ...item, score: null });
  }
  return out;
}

export function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Visibility a viewer may give an item: everyone below public; public only for district roles or with review. */
export function allowedVisibilities(viewer: Viewer): Visibility[] {
  return isStaff(viewer) ? [...VISIBILITIES] : ['private'];
}

/** A snapshot of what an item was at a version: metadata and, for interactive content, its parameters. */
export function snapshotOf(
  item: {
    title: string;
    description: string | null;
    subject: string | null;
    gradeLevel: string | null;
    topics: string | null;
    standards: string | null;
    keywords: string | null;
    url: string | null;
    fileId: string | null;
    h5pContentId: string | null;
    lessonPlanId: string | null;
  },
  parameters: unknown,
): string {
  return JSON.stringify({
    title: item.title,
    description: item.description,
    subject: item.subject,
    gradeLevel: item.gradeLevel,
    topics: parseList(item.topics),
    standards: parseList(item.standards),
    keywords: item.keywords,
    url: item.url,
    fileId: item.fileId,
    h5pContentId: item.h5pContentId,
    lessonPlanId: item.lessonPlanId,
    parameters: parameters ?? null,
  });
}
